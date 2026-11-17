import { after, NextResponse, type NextRequest } from "next/server";
import { loadSecrets } from "@/lib/secrets";
import { ensureWebsub } from "@/lib/websub";
import { CHANNEL_ID } from "@/lib/channel";
import { exchangeCode, isChannelKey, listYoutubeChannels, MAIN_CHANNEL, redirectUri, saveYoutubeAuth } from "@/lib/youtube";

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
  const ch = state.split(".")[1] ?? MAIN_CHANNEL;
  if (!isChannelKey(ch)) return back("error");
  try {
    const auth = await exchangeCode(code, redirectUri(url.origin));
    // Hai kênh cùng account Google: chọn nhầm kênh ở màn Google thì token sẽ đăng lẫn kênh → chặn.
    if (auth.channelId) {
      if ((ch === MAIN_CHANNEL) !== (auth.channelId === CHANNEL_ID)) return back("wrong-channel");
      const clash = (await listYoutubeChannels()).find((c) => c.key !== ch && c.auth.channelId === auth.channelId);
      if (clash) return back("wrong-channel");
    }
    await saveYoutubeAuth(auth, ch);
    // Kênh mới / kết nối lại: đăng ký webhook ngay (không chờ daily). Lỗi chỉ ghi log.
    after(() => ensureWebsub({ force: true, channel: ch }).catch((e) => console.warn("WebSub:", e instanceof Error ? e.message : e)));
    return back("connected");
  } catch (e) {
    console.error("Kết nối YouTube lỗi:", e);
    return back("error");
  }
}
