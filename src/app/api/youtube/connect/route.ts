import { NextResponse, type NextRequest } from "next/server";
import { authUrl, redirectUri } from "@/lib/youtube";

const STATE_COOKIE = "yt_oauth_state";

/** Bắt đầu kết nối YouTube: chuyển sang màn đồng ý của Google. `state` chống giả mạo callback. */
export async function GET(request: NextRequest) {
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(authUrl(state, redirectUri(request.nextUrl.origin)));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/youtube" });
  return res;
}
