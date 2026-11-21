import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";

/**
 * Page Facebook theo kênh (mẫu giống token YouTube): token Page mã hoá ở app_settings "facebook:<kênh>".
 * Kết nối ở web Cài đặt AI → Facebook Page — user token ngắn hạn → dài hạn → token Page không hết hạn.
 */
export const GRAPH_VERSION = "v27.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const fbKey = (ch: string) => `facebook:${ch}`;
export type FacebookAuth = { pageId: string; pageName: string; pageToken: string; connectedAt: string };
type PageAccount = { id: string; name: string; access_token: string };

/** Token hết hạn/bị thu hồi — kết nối lại ở Cài đặt AI. */
export class FacebookAuthError extends Error {}

/** Lỗi Graph API → thông điệp tiếng Việt; tách lỗi token (190) khỏi lỗi thiếu quyền. */
export function graphError(body: unknown, status: number): Error {
  const e = (body as { error?: { code?: number; message?: string } } | null)?.error;
  const msg = e?.message ?? `HTTP ${status}`;
  if (e?.code === 190) return new FacebookAuthError(`Token Facebook hết hạn hoặc bị thu hồi — kết nối lại ở Cài đặt AI → Facebook Page. (${msg})`);
  if (e?.code === 10 || (e?.code != null && e.code >= 200 && e.code < 300))
    return new Error(`Facebook từ chối vì app thiếu quyền (cần quyền đăng video/Reels, có thể phải App Review): ${msg}`);
  return new Error(`Facebook lỗi (${status}): ${msg}`);
}

export function pickPage(accounts: PageAccount[], pageId: string): PageAccount {
  const page = accounts.find((a) => a.id === pageId);
  if (page) return page;
  const found = accounts.map((a) => `${a.name} (${a.id})`).join(", ") || "không có Page nào";
  throw new Error(`Tài khoản không quản lý Page ${pageId}. Page tìm thấy: ${found}`);
}

function app() {
  const id = process.env.FB_APP_ID;
  const secret = process.env.FB_APP_SECRET;
  if (!id || !secret) throw new Error("Thiếu FB_APP_ID / FB_APP_SECRET — xem README phần Kết nối Facebook Page.");
  return { id, secret };
}

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  return graphJson<T>(await fetch(`${GRAPH}${path}?${new URLSearchParams(params)}`));
}

export async function exchangePageToken(userToken: string, pageId: string): Promise<FacebookAuth> {
  const { id, secret } = app();
  const long = await graphGet<{ access_token: string }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: id,
    client_secret: secret,
    fb_exchange_token: userToken,
  }).catch((e: unknown) => {
    if (e instanceof FacebookAuthError)
      throw new FacebookAuthError("User token vừa dán đã hết hạn hoặc sai — tạo token mới ở Graph API Explorer rồi dán ngay (token chỉ sống 1–2 giờ).");
    throw e;
  });
  const accounts = await graphGet<{ data?: PageAccount[] }>("/me/accounts", { access_token: long.access_token, limit: "100" });
  const page = pickPage(accounts.data ?? [], pageId);
  return { pageId: page.id, pageName: page.name, pageToken: page.access_token, connectedAt: new Date().toISOString() };
}

export function parseFacebookAuth(raw: unknown): FacebookAuth | null {
  const v = raw as Partial<FacebookAuth> | undefined;
  if (!v?.pageToken || !v.pageId) return null;
  return { pageId: v.pageId, pageName: v.pageName ?? "", pageToken: decrypt(v.pageToken), connectedAt: v.connectedAt ?? "" };
}

export async function getFacebookAuth(ch: string): Promise<FacebookAuth | null> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, fbKey(ch)));
  return parseFacebookAuth(row?.value);
}

export async function saveFacebookAuth(auth: FacebookAuth | null, ch: string) {
  if (!auth) return void (await db().delete(appSettings).where(eq(appSettings.key, fbKey(ch))));
  const value = { ...auth, pageToken: encrypt(auth.pageToken) };
  await db()
    .insert(appSettings)
    .values({ key: fbKey(ch), value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export const REEL_MIN_SECONDS = 3;
export const REEL_MAX_SECONDS = 90;

/** Reels API chỉ nhận 3–90 giây — chặn trước khi tốn lượt upload. */
export function assertReelDuration(seconds: number) {
  if (!(seconds >= REEL_MIN_SECONDS && seconds <= REEL_MAX_SECONDS))
    throw new Error(`Reel phải dài ${REEL_MIN_SECONDS}–${REEL_MAX_SECONDS} giây, file này ${seconds.toFixed(1)} giây.`);
}

type PageRef = { pageId: string; token: string };
/** `draft`: tải lên dạng nháp, chủ kênh tự bấm đăng trên Meta Business Suite (app chưa phát hành thì bài app đăng chỉ admin thấy). */
type ReelOptions = { description: string; seconds: number; scheduledAt?: Date; draft?: boolean };
const MS_PER_SECOND = 1000;
const unix = (d: Date) => String(Math.floor(d.getTime() / MS_PER_SECOND));

async function graphJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok || body.error) throw graphError(body, res.status);
  return body;
}

async function graphPost<T>(url: string, params: Record<string, string>): Promise<T> {
  return graphJson<T>(await fetch(url, { method: "POST", body: new URLSearchParams(params) }));
}

function reelState(opts: ReelOptions): Record<string, string> {
  if (opts.draft) return { video_state: "DRAFT" };
  if (opts.scheduledAt) return { video_state: "SCHEDULED", scheduled_publish_time: unix(opts.scheduledAt) };
  return { video_state: "PUBLISHED" };
}

/** Đăng Reel 3 pha: start (lấy video_id + upload_url) → upload nhị phân → finish (đăng ngay hoặc hẹn giờ). */
export async function publishReelAs(page: PageRef, file: string, opts: ReelOptions): Promise<{ videoId: string }> {
  assertReelDuration(opts.seconds);
  const { readFile } = await import("node:fs/promises");
  const videoBytes = await readFile(file);
  const endpoint = `${GRAPH}/${page.pageId}/video_reels`;
  const start = await graphPost<{ video_id: string; upload_url: string }>(endpoint, { upload_phase: "start", access_token: page.token });
  await graphJson(
    await fetch(start.upload_url, {
      method: "POST",
      headers: { Authorization: `OAuth ${page.token}`, offset: "0", file_size: String(videoBytes.length) },
      body: videoBytes,
    }),
  );
  await graphPost(endpoint, {
    upload_phase: "finish",
    access_token: page.token,
    video_id: start.video_id,
    description: opts.description,
    ...reelState(opts),
  });
  return { videoId: start.video_id };
}

const GRAPH_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`;
/** Chờ trước mỗi lần thử lại một mảnh (mạng chập vài giây thì thử ngay cũng hỏng): 1 lần gửi + 3 lần thử lại. */
export const CHUNK_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];
/** Một mảnh treo quá lâu thì huỷ để thử lại, không giữ job mãi. */
const CHUNK_TIMEOUT_MS = 120_000;
const HTTP_SERVER_ERROR = 500;
type VideoOptions = { title: string; description: string; scheduledAt?: Date; draft?: boolean };
/** Chờ giữa các lần thử lại — test truyền bản giả để không phải chờ thật. */
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));
type Offsets = { start_offset: string; end_offset: string };

/**
 * Đăng video dài lên Page bằng upload chia mảnh (start → transfer… → finish). Đọc từng mảnh theo offset
 * Facebook trả về, không nạp cả file 45 phút vào RAM. Mảnh hỏng quá số lần thử thì ném lỗi, không finish.
 */
export async function publishPageVideoAs(page: PageRef, file: string, opts: VideoOptions, sleep: Sleep = realSleep): Promise<{ videoId: string }> {
  const { open, stat } = await import("node:fs/promises");
  const endpoint = `${GRAPH_VIDEO}/${page.pageId}/videos`;
  const fileSize = (await stat(file)).size;
  const session = await graphPost<Offsets & { upload_session_id: string; video_id: string }>(endpoint, {
    upload_phase: "start",
    access_token: page.token,
    file_size: String(fileSize),
  });
  const videoFile = await open(file, "r");
  try {
    let range = parseOffsets(session, -1);
    for (let chunkNo = 1; range.start !== range.end; chunkNo++) {
      const chunk = Buffer.alloc(range.end - range.start);
      await videoFile.read(chunk, 0, chunk.length, range.start);
      const next = await sendChunk({ endpoint, token: page.token, sessionId: session.upload_session_id, begin: range.start, chunk, chunkNo, sleep });
      range = parseOffsets(next, range.start);
    }
    if (range.start !== fileSize) throw new Error(`Upload Facebook dừng ở byte ${range.start}/${fileSize} — không đăng video thiếu.`);
  } finally {
    await videoFile.close();
  }
  await graphPost(endpoint, {
    upload_phase: "finish",
    access_token: page.token,
    upload_session_id: session.upload_session_id,
    title: opts.title,
    description: opts.description,
    ...videoPublishState(opts),
  });
  return { videoId: session.video_id };
}

/** Offset Facebook trả phải là số và tiến lên; thiếu/lùi thì dừng thay vì finish với file thiếu. */
function parseOffsets(o: Partial<Offsets>, previousStart: number): { start: number; end: number } {
  const start = Number(o.start_offset);
  const end = Number(o.end_offset);
  const valid = o.start_offset != null && o.end_offset != null && Number.isInteger(start) && Number.isInteger(end) && end >= start;
  if (!valid || start <= previousStart) throw new Error(`Facebook trả offset không hợp lệ (${JSON.stringify(o)}) — dừng upload.`);
  return { start, end };
}

function videoPublishState(opts: VideoOptions): Record<string, string> {
  if (opts.draft) return { published: "false" };
  if (opts.scheduledAt) return { published: "false", scheduled_publish_time: unix(opts.scheduledAt) };
  return {};
}

type ChunkUpload = { endpoint: string; token: string; sessionId: string; begin: number; chunk: Buffer; chunkNo: number; sleep: Sleep };

/**
 * Gửi một mảnh. Chỉ thử lại (có chờ tăng dần) khi lỗi mạng/hết giờ hoặc HTTP 5xx; lỗi token/quyền/4xx ném ngay.
 * Trả offset mảnh kế tiếp.
 */
async function sendChunk({ endpoint, token, sessionId, begin, chunk, chunkNo, sleep }: ChunkUpload): Promise<Partial<Offsets>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= CHUNK_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(CHUNK_RETRY_DELAYS_MS[attempt - 1]);
    const form = new FormData();
    form.set("upload_phase", "transfer");
    form.set("access_token", token);
    form.set("upload_session_id", sessionId);
    form.set("start_offset", String(begin));
    form.set("video_file_chunk", new Blob([new Uint8Array(chunk)]), "chunk.mp4");
    let res: Response;
    try {
      res = await fetch(endpoint, { method: "POST", body: form, signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS) });
    } catch (e) {
      lastError = e; // mạng chập / hết giờ → thử lại
      continue;
    }
    if (res.status < HTTP_SERVER_ERROR) return graphJson<Partial<Offsets>>(res);
    lastError = graphError(await res.json().catch(() => ({})), res.status);
  }
  throw new Error(`Upload Facebook hỏng ở mảnh ${chunkNo} (byte ${begin}): ${lastError instanceof Error ? lastError.message : lastError}`);
}

/** Đăng video dài lên Page đã kết nối của kênh; ném FacebookAuthError nếu kênh chưa kết nối hoặc token hỏng. */
export async function publishPageVideo(ch: string, file: string, opts: VideoOptions) {
  return publishPageVideoAs(await pageAccessToken(ch), file, opts);
}

/** Đăng Reel lên Page đã kết nối của kênh; ném FacebookAuthError nếu kênh chưa kết nối hoặc token hỏng. */
export async function publishReel(ch: string, file: string, opts: ReelOptions) {
  return publishReelAs(await pageAccessToken(ch), file, opts);
}

/** Page đã kết nối (cho trang Cài đặt) — chỉ tên + id, không bao giờ trả token. */
export function pagesFromRows(rows: { key: string; value: unknown }[]): { channel: string; pageName: string; pageId: string }[] {
  const prefix = fbKey("");
  return rows.flatMap((r) => {
    if (!r.key.startsWith(prefix)) return [];
    const v = r.value as Partial<FacebookAuth> | undefined;
    return v?.pageId && v.pageToken ? [{ channel: r.key.slice(prefix.length), pageName: v.pageName ?? "", pageId: v.pageId }] : [];
  });
}

export async function listFacebookPages() {
  return pagesFromRows(await db().select({ key: appSettings.key, value: appSettings.value }).from(appSettings));
}

export async function pageAccessToken(ch: string): Promise<{ pageId: string; token: string }> {
  const auth = await getFacebookAuth(ch);
  if (!auth) throw new FacebookAuthError(`Chưa kết nối Facebook cho kênh "${ch}" — kết nối ở Cài đặt AI → Facebook Page.`);
  return { pageId: auth.pageId, token: auth.pageToken };
}
