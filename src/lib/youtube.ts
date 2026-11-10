import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";
import { recordYoutubeUnits } from "./yt-units";

export const YT_KEY = "youtube";
export type YoutubeAuth = { refreshToken: string; channel: string | null; connectedAt: string };

/** Token bị thu hồi/hết hạn — người dùng phải bấm "Kết nối YouTube" lại. */
export class YoutubeAuthError extends Error {}

// youtube.upload để đăng; youtube.force-ssl để đặt thumbnail và đọc tên kênh.
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"];

function client() {
  const id = process.env.YOUTUBE_CLIENT_ID;
  const secret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Thiếu YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET — xem README phần Tự đăng YouTube.");
  return { id, secret };
}

export function authUrl(state: string, redirectUri: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Luôn hỏi lại để Google trả refresh token mới.
    prompt: "consent",
    state,
  }).toString();
  return url.toString();
}

async function token(params: Record<string, string>) {
  const { id, secret } = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
  if (body.error === "invalid_grant") throw new YoutubeAuthError("Token YouTube đã hết hạn hoặc bị thu hồi — bấm “Kết nối YouTube” lại.");
  if (!res.ok || !body.access_token) throw new Error(`Google OAuth lỗi: ${body.error_description ?? body.error ?? res.status}`);
  return body;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<YoutubeAuth> {
  const t = await token({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("Google không trả refresh token — gỡ quyền app ở myaccount.google.com/permissions rồi kết nối lại.");
  const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { items?: { snippet?: { title?: string } }[] };
  return { refreshToken: t.refresh_token, channel: body.items?.[0]?.snippet?.title ?? null, connectedAt: new Date().toISOString() };
}

export async function accessToken(refreshToken: string) {
  return (await token({ refresh_token: refreshToken, grant_type: "refresh_token" })).access_token!;
}

/** Bản ghi app_settings[YT_KEY] → thông tin kênh. Token lưu mã hoá; token cũ (trước khi có mã hoá) vẫn đọc được. */
export function parseYoutubeAuth(raw: unknown): YoutubeAuth | null {
  const v = raw as Partial<YoutubeAuth> | undefined;
  if (!v?.refreshToken) return null;
  return { refreshToken: decrypt(v.refreshToken), channel: v.channel ?? null, connectedAt: v.connectedAt ?? "" };
}

export async function getYoutubeAuth(): Promise<YoutubeAuth | null> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, YT_KEY));
  return parseYoutubeAuth(row?.value);
}

export async function saveYoutubeAuth(auth: YoutubeAuth | null) {
  if (!auth) return void (await db().delete(appSettings).where(eq(appSettings.key, YT_KEY)));
  const value = { ...auth, refreshToken: encrypt(auth.refreshToken) };
  await db()
    .insert(appSettings)
    .values({ key: YT_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export const redirectUri = (origin: string) => `${origin}/api/youtube/callback`;

/** YouTube từ chối tag tổng > 500 ký tự (tag có dấu cách tính thêm 2 dấu ngoặc) và ký tự < > trong tiêu đề/mô tả. */
export function cleanTags(tags: string[]) {
  const out: string[] = [];
  let used = 0;
  for (const raw of tags) {
    const t = raw.replace(/[<>,]/g, "").trim();
    if (!t) continue;
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (used + cost > 500) break;
    out.push(t);
    used += cost;
  }
  return out;
}
export const noAngle = (s: string) => s.replace(/[<>]/g, "");

/** Sửa tiêu đề / mô tả / tag của video đã có trên YouTube (videos.update ghi đè cả snippet nên gửi đủ trường). */
export async function updateYoutubeSnippet(youtubeId: string, s: { title: string; description: string; tags: string[] }) {
  const auth = await getYoutubeAuth();
  if (!auth) throw new YoutubeAuthError("Chưa kết nối YouTube.");
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=snippet", {
    method: "PUT",
    headers: { Authorization: `Bearer ${await accessToken(auth.refreshToken)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: youtubeId,
      snippet: { title: noAngle(s.title).slice(0, 100), description: noAngle(s.description).slice(0, 5000), tags: cleanTags(s.tags), categoryId: "24", defaultLanguage: "vi" },
    }),
  });
  await recordYoutubeUnits("videoUpdate");
  if (!res.ok) throw new Error(`YouTube từ chối cập nhật: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Đổi giờ công chiếu của video đang ở chế độ lên lịch (private + publishAt). Video đã công khai thì YouTube từ chối — bỏ qua. */
export async function updateYoutubePublishAt(youtubeId: string, publishAt: Date) {
  const auth = await getYoutubeAuth();
  if (!auth) throw new YoutubeAuthError("Chưa kết nối YouTube.");
  const res = await fetch("https://www.googleapis.com/youtube/v3/videos?part=status", {
    method: "PUT",
    headers: { Authorization: `Bearer ${await accessToken(auth.refreshToken)}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: youtubeId, status: { privacyStatus: "private", publishAt: publishAt.toISOString(), selfDeclaredMadeForKids: false } }),
  });
  if (!res.ok) throw new Error(`YouTube từ chối đổi lịch: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
