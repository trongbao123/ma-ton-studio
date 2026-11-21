import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { decrypt, encrypt } from "./crypto";

/**
 * Page Facebook theo kênh (mẫu giống token YouTube): token Page mã hoá ở app_settings "facebook:<kênh>".
 * Kết nối bằng CLI scripts/fb-connect.mts — user token ngắn hạn → dài hạn → token Page không hết hạn.
 */
export const GRAPH_VERSION = "v27.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const fbKey = (ch: string) => `facebook:${ch}`;
export type FacebookAuth = { pageId: string; pageName: string; pageToken: string; connectedAt: string };
type PageAccount = { id: string; name: string; access_token: string };

/** Token hết hạn/bị thu hồi — chạy lại lệnh kết nối. */
export class FacebookAuthError extends Error {}

/** Lỗi Graph API → thông điệp tiếng Việt; tách lỗi token (190) khỏi lỗi thiếu quyền. */
export function graphError(body: unknown, status: number): Error {
  const e = (body as { error?: { code?: number; message?: string } } | null)?.error;
  const msg = e?.message ?? `HTTP ${status}`;
  if (e?.code === 190) return new FacebookAuthError(`Token Facebook hết hạn hoặc bị thu hồi — chạy lại scripts/fb-connect.mts. (${msg})`);
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
  const url = `${GRAPH}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url);
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown };
  if (!res.ok || body.error) throw graphError(body, res.status);
  return body;
}

export async function exchangePageToken(userToken: string, pageId: string): Promise<FacebookAuth> {
  const { id, secret } = app();
  const long = await graphGet<{ access_token: string }>("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: id,
    client_secret: secret,
    fb_exchange_token: userToken,
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
  if (!auth) throw new FacebookAuthError(`Chưa kết nối Facebook cho kênh "${ch}" — chạy scripts/fb-connect.mts.`);
  return { pageId: auth.pageId, token: auth.pageToken };
}
