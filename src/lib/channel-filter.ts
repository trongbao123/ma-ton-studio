// Kênh đang xem trên web (bộ chọn ở thanh bên): lưu cookie, các trang Xưởng truyện / Truyện / Video lọc theo đó.
// Chỉ là bộ lọc hiển thị — pipeline luôn chạy mọi kênh.
import { cookies } from "next/headers";
import { CHANNEL_NAME } from "./channel";
import { channelProfile } from "./channel-profile";
import { isChannelKey, listYoutubeChannels, MAIN_CHANNEL } from "./youtube";

export const CHANNEL_COOKIE = "view_channel";
export const ALL_CHANNELS = "all";

/** Kênh đang chọn; null = tất cả. */
export async function viewChannel(): Promise<string | null> {
  const v = (await cookies()).get(CHANNEL_COOKIE)?.value;
  return v && v !== ALL_CHANNELS && isChannelKey(v) ? v : null;
}

export type ChannelOption = { key: string; name: string; youtubeId: string | null };

/** Tên hiển thị: kênh gốc dùng tên thương hiệu; kênh phụ dùng tên trong hồ sơ / tên YouTube lúc kết nối. */
export function channelName(key: string, ytTitle?: string | null) {
  if (key === MAIN_CHANNEL) return CHANNEL_NAME;
  return channelProfile(key).youtubeTitle ?? ytTitle ?? key;
}

/** Các kênh để chọn: kênh đã kết nối + kênh có bộ truyện (chưa kết nối vẫn hiện). */
export async function channelOptions(seriesChannels: string[] = []): Promise<ChannelOption[]> {
  const connected = await listYoutubeChannels().catch(() => []);
  const keys = [...new Set([MAIN_CHANNEL, ...connected.map((c) => c.key), ...seriesChannels])];
  return keys.map((key) => {
    const auth = connected.find((c) => c.key === key)?.auth;
    return { key, name: channelName(key, auth?.channel), youtubeId: auth?.channelId ?? null };
  });
}
