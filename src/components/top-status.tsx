import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { TopStatusLive } from "@/components/top-status-live";
import { isAuthorized } from "@/lib/auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { topStatus } from "@/lib/usage-data";
import { readStatsSnapshot } from "@/lib/youtube-stats";

/** Trang kênh trên YouTube (đổi kênh thì đặt YOUTUBE_CHANNEL_URL). */
import { CHANNEL_URL } from "@/lib/channel";
import { channelName, viewChannel } from "@/lib/channel-filter";
import { channelUrlOf, getYoutubeAuth } from "@/lib/youtube";

/**
 * Thanh trên cùng: render lần đầu ở server, sau đó TopStatusLive nhận cập nhật realtime qua SSE (/api/live).
 * Gồm video đang render (bấm để mở) + đèn hạn mức từng AI (bấm sang trang Hạn mức) + tổng view + kênh YouTube.
 * Chỉ hiện khi đã đăng nhập — layout cũng bọc trang /login nên không được lộ dữ liệu ở đó.
 */
export async function TopStatus() {
  await connection();
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER;
  const authed =
    (await verifySession((await cookies()).get(SESSION_COOKIE)?.value, password, user)) ||
    isAuthorized((await headers()).get("authorization"), password, user);
  if (!authed) return null;

  const [s, stats] = await Promise.all([topStatus().catch(() => null), readStatsSnapshot()]);
  if (!s) return null;
  const { channel, ...status } = s;
  // Đang lọc theo kênh phụ: nút YouTube mở đúng kênh đó.
  const view = await viewChannel();
  if (view && view !== "main") {
    const auth = await getYoutubeAuth(view).catch(() => null);
    return (
      <TopStatusLive
        initial={status}
        initialChannelStat={null}
        showViews={false}
        channel={auth ? channelName(view, auth.channel) : null}
        channelUrl={await channelUrlOf(view)}
      />
    );
  }
  return <TopStatusLive initial={status} initialChannelStat={stats.channel} channel={channel} channelUrl={CHANNEL_URL} />;
}
