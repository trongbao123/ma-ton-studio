import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

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

export async function getYoutubeAuth(): Promise<YoutubeAuth | null> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, YT_KEY));
  const v = row?.value as Partial<YoutubeAuth> | undefined;
  return v?.refreshToken ? { refreshToken: v.refreshToken, channel: v.channel ?? null, connectedAt: v.connectedAt ?? "" } : null;
}

export async function saveYoutubeAuth(auth: YoutubeAuth | null) {
  if (!auth) return void (await db().delete(appSettings).where(eq(appSettings.key, YT_KEY)));
  await db()
    .insert(appSettings)
    .values({ key: YT_KEY, value: auth })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: auth, updatedAt: new Date() } });
}

export const redirectUri = (origin: string) => `${origin}/api/youtube/callback`;
