import { NextResponse, type NextRequest } from "next/server";
import { loadSecrets } from "@/lib/secrets";
import { authUrl, isChannelKey, MAIN_CHANNEL, redirectUri } from "@/lib/youtube";

const STATE_COOKIE = "yt_oauth_state";

/**
 * Bắt đầu kết nối YouTube: chuyển sang màn đồng ý của Google. `state` chống giả mạo callback.
 * `?channel=<khoá>` = kết nối kênh phụ (mặc định kênh gốc). Kênh cùng account Google: chọn đúng kênh ở màn "Chọn tài khoản".
 */
export async function GET(request: NextRequest) {
  await loadSecrets();
  const ch = request.nextUrl.searchParams.get("channel") ?? MAIN_CHANNEL;
  if (!isChannelKey(ch)) return new Response("Khoá kênh không hợp lệ", { status: 400 });
  // Khoá kênh nằm sau dấu "." trong state (state cũng lưu trong cookie nên không giả được).
  const state = `${crypto.randomUUID()}.${ch}`;
  const res = NextResponse.redirect(authUrl(state, redirectUri(request.nextUrl.origin)));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/youtube" });
  return res;
}
