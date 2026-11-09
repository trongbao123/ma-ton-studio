import { NextResponse, type NextRequest } from "next/server";
import { loadSecrets } from "@/lib/secrets";
import { exchangeCode, redirectUri, saveYoutubeAuth } from "@/lib/youtube";

export async function GET(request: NextRequest) {
  await loadSecrets();
  const url = request.nextUrl;
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/videos?youtube=${q}`, url.origin));
    res.cookies.delete({ name: "yt_oauth_state", path: "/api/youtube" });
    return res;
  };
  const state = request.cookies.get("yt_oauth_state")?.value;
  const code = url.searchParams.get("code");
  if (!code || !state || state !== url.searchParams.get("state")) return back("error");
  try {
    await saveYoutubeAuth(await exchangeCode(code, redirectUri(url.origin)));
    return back("connected");
  } catch (e) {
    console.error("Kết nối YouTube lỗi:", e);
    return back("error");
  }
}
