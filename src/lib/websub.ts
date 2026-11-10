import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { WEB_URL } from "./notify";
import { accessToken, getYoutubeAuth } from "./youtube";

/**
 * Webhook YouTube (WebSub / PubSubHubbub): kênh đăng video hoặc ĐỔI TIÊU ĐỀ / MÔ TẢ thì hub của Google POST feed Atom
 * về /api/youtube/websub trong vài giây–vài phút → app kéo ngay bản mới về DB. Đổi tag thì YouTube không báo
 * (vòng số liệu 60 giây trong youtube-stats bù phần đó). Đăng ký có hạn (hub cho tối đa ~5–10 ngày) nên phải gia hạn.
 */
export const HUB = "https://pubsubhubbub.appspot.com/subscribe";
export const WEBSUB_PATH = "/api/youtube/websub";
const STATE_KEY = "yt_websub";
/** Xin 10 ngày; còn dưới 2 ngày thì gia hạn (daily chạy 2 lượt/ngày nên luôn kịp). */
const LEASE_SECONDS = 864_000;
const RENEW_BEFORE_MS = 2 * 86_400_000;

export type WebsubState = { channelId: string; topic: string; callback: string; requestedAt: string; verifiedAt?: string; expiresAt?: string };

export const topicFor = (channelId: string) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;

/** Bí mật ký HMAC cho hub — suy từ SECRETS_KEY nên không phải lưu thêm. */
export function websubSecret() {
  const key = process.env.SECRETS_KEY;
  if (!key) throw new Error("Thiếu SECRETS_KEY");
  return createHmac("sha256", key).update("youtube-websub").digest("hex").slice(0, 40);
}

/** Kiểm header `X-Hub-Signature: sha1=<hex>` (hub ký thân request bằng hub.secret). */
export function verifySignature(body: string, header: string | null, secret: string) {
  const m = header?.match(/^sha1=([0-9a-f]{40})$/i);
  if (!m) return false;
  const want = createHmac("sha1", secret).update(body, "utf8").digest();
  const got = Buffer.from(m[1], "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Id video trong feed Atom (`<yt:videoId>`); bỏ trùng. Bản tin xoá video (`at:deleted-entry`) không có videoId nên tự bị bỏ. */
export function parseFeedVideoIds(xml: string): string[] {
  return [...new Set([...xml.matchAll(/<yt:videoId>\s*([A-Za-z0-9_-]{11})\s*<\/yt:videoId>/g)].map((m) => m[1]))];
}

/** Id kênh trong feed (`<yt:channelId>`), để chỉ nhận tin của đúng kênh mình. */
export function parseFeedChannelId(xml: string): string | null {
  return xml.match(/<yt:channelId>\s*(UC[A-Za-z0-9_-]{22})\s*<\/yt:channelId>/)?.[1] ?? null;
}

export async function readWebsubState(): Promise<WebsubState | null> {
  const [row] = await db().select().from(appSettings).where(eq(appSettings.key, STATE_KEY));
  return (row?.value as WebsubState | undefined) ?? null;
}

async function saveState(value: WebsubState) {
  await db()
    .insert(appSettings)
    .values({ key: STATE_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Hub gọi GET xác nhận đăng ký → ghi lại hạn để biết khi nào gia hạn. */
export async function markVerified(topic: string, leaseSeconds: number | null) {
  const s = await readWebsubState();
  if (!s || s.topic !== topic) return false;
  const now = Date.now();
  await saveState({ ...s, verifiedAt: new Date(now).toISOString(), expiresAt: new Date(now + (leaseSeconds ?? LEASE_SECONDS) * 1000).toISOString() });
  return true;
}

/** Cần (gia hạn) đăng ký không: chưa từng, chưa được hub xác nhận sau 1 giờ, sắp hết hạn, hoặc đổi tên miền. */
export function needsRenew(s: WebsubState | null, callback: string, now = Date.now()) {
  if (!s || s.callback !== callback) return true;
  if (!s.expiresAt) return now - Date.parse(s.requestedAt) > 3_600_000;
  return Date.parse(s.expiresAt) - now < RENEW_BEFORE_MS;
}

async function myChannelId(): Promise<string | null> {
  const yt = await getYoutubeAuth();
  if (!yt) return null;
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id&mine=true", {
    headers: { Authorization: `Bearer ${await accessToken(yt.refreshToken)}` },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { items?: { id?: string }[] };
  return body.items?.[0]?.id ?? null;
}

/**
 * Đăng ký / gia hạn webhook nếu cần (`force` = luôn gửi). Trả lý do bỏ qua hoặc "requested".
 * Gọi từ daily (2 lượt/ngày) và lúc kết nối YouTube. Hub xác nhận bất đồng bộ qua GET /api/youtube/websub.
 */
export async function ensureWebsub(opts: { force?: boolean; baseUrl?: string } = {}) {
  const callback = `${(opts.baseUrl ?? WEB_URL).replace(/\/$/, "")}${WEBSUB_PATH}`;
  const state = await readWebsubState();
  if (!opts.force && !needsRenew(state, callback)) return "fresh";
  const channelId = state?.channelId ?? (await myChannelId());
  if (!channelId) return "no-channel";
  const topic = topicFor(channelId);
  await saveState({ channelId, topic, callback, requestedAt: new Date().toISOString() });
  const res = await fetch(HUB, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      "hub.callback": callback,
      "hub.topic": topic,
      "hub.mode": "subscribe",
      "hub.verify": "async",
      "hub.secret": websubSecret(),
      "hub.lease_seconds": String(LEASE_SECONDS),
    }),
  });
  if (res.status !== 202 && res.status !== 204) throw new Error(`Hub WebSub trả ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return "requested";
}
