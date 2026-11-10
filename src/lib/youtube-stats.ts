import { desc, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, videos } from "@/db/schema";
import { chunk } from "./batch";
import type { ChannelStat, LiveStats, YtStat, YtStatsMap } from "./live/types";
import { accessToken, getYoutubeAuth, YoutubeAuthError } from "./youtube";

/** Snapshot để trang mở lần đầu có số ngay (không cần migration — dùng bảng app_settings). */
export const STATS_KEY = "yt_stats";
export const CHANNEL_STATS_KEY = "yt_channel_stats";

const API = "https://www.googleapis.com/youtube/v3";
/** Số liệu cũ hơn mức này mới gọi lại; cũng là thời gian nhớ trong bộ nhớ. */
const STATS_TTL_MS = 60_000;
/** Tổng view kênh đổi chậm — 5 phút/lần là đủ, đỡ tốn quota. */
const CHANNEL_TTL_MS = 5 * 60_000;
/** videos.list nhận tối đa 50 id/lượt (1 quota unit/lượt). */
const BATCH = 50;
/** Số video mới nhất (có id YouTube) được làm mới định kỳ. */
const RECENT_VIDEOS = 30;
/** Lệch nhẹ giữa các nhịp 60s của SSE để không bỏ lỡ vì vài trăm ms. */
const TTL_SLACK_MS = 5_000;
const TOKEN_TTL_MS = 45 * 60_000;

const emptyStats = (): LiveStats => ({ videos: {}, channel: null });

let mem: { stats: LiveStats; at: number } | null = null;
let inflight: Promise<LiveStats> | null = null;
/** Hết quota / lỗi liên tục thì nghỉ gọi đến mốc này (ms epoch), vẫn trả số cũ. */
let blockedUntil = 0;
let token: { refresh: string; value: string; at: number } | null = null;

/** Đọc snapshot đã lưu (1 truy vấn). Lỗi DB → rỗng, UI chỉ ẩn số. */
export async function readStatsSnapshot(): Promise<LiveStats> {
  try {
    const rows = await db().select().from(appSettings).where(inArray(appSettings.key, [STATS_KEY, CHANNEL_STATS_KEY]));
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    return { videos: (get(STATS_KEY) as YtStatsMap | undefined) ?? {}, channel: (get(CHANNEL_STATS_KEY) as ChannelStat | undefined) ?? null };
  } catch {
    return emptyStats();
  }
}

async function saveSnapshot(key: string, value: unknown) {
  await db()
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Id YouTube (video dài + Short) của các video mới nhất. */
async function recentYoutubeIds(): Promise<string[]> {
  const rows = await db()
    .select({ long: videos.youtubeVideoId, short: videos.youtubeShortId })
    .from(videos)
    .where(or(isNotNull(videos.youtubeVideoId), isNotNull(videos.youtubeShortId)))
    .orderBy(desc(videos.id))
    .limit(RECENT_VIDEOS);
  return rows.flatMap((r) => [r.long, r.short]).filter((x): x is string => Boolean(x));
}

async function bearer(refreshToken: string): Promise<string> {
  if (token && token.refresh === refreshToken && Date.now() - token.at < TOKEN_TTL_MS) return token.value;
  const value = await accessToken(refreshToken);
  token = { refresh: refreshToken, value, at: Date.now() };
  return value;
}

type ApiError = { error?: { code?: number; errors?: { reason?: string }[] } };

/** Lỗi API → đặt thời gian nghỉ phù hợp (hết quota nghỉ lâu, lỗi khác nghỉ ngắn). */
function backOff(status: number, body: ApiError) {
  const reason = body.error?.errors?.[0]?.reason ?? "";
  if (status === 401) token = null;
  const wait = reason === "quotaExceeded" || reason === "rateLimitExceeded" ? 30 * 60_000 : 2 * 60_000;
  blockedUntil = Date.now() + wait;
}

async function callApi<T>(path: string, auth: string): Promise<T | null> {
  const res = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${auth}` }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    backOff(res.status, body);
    return null;
  }
  return body;
}

type VideoItem = { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } };

const num = (s: string | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

async function fetchVideoStats(ids: string[], auth: string): Promise<YtStatsMap> {
  const out: YtStatsMap = {};
  for (const batch of chunk(ids, BATCH)) {
    const body = await callApi<{ items?: VideoItem[] }>(`videos?part=statistics&maxResults=${BATCH}&id=${batch.join(",")}`, auth);
    if (!body) break;
    const at = Date.now();
    for (const it of body.items ?? []) {
      const s = it.statistics ?? {};
      out[it.id] = { views: num(s.viewCount), likes: num(s.likeCount), comments: num(s.commentCount), at } satisfies YtStat;
    }
  }
  return out;
}

async function fetchChannelStat(auth: string): Promise<ChannelStat | null> {
  const body = await callApi<{ items?: { statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean } }[] }>("channels?part=statistics&mine=true", auth);
  const s = body?.items?.[0]?.statistics;
  if (!s) return null;
  return { views: num(s.viewCount), subscribers: s.hiddenSubscriberCount ? null : num(s.subscriberCount), videos: num(s.videoCount), at: Date.now() };
}

async function refresh(extraIds: string[]): Promise<LiveStats> {
  const snap = await readStatsSnapshot();
  const now = Date.now();
  const wanted = [...new Set([...(await recentYoutubeIds()), ...extraIds])];
  const stale = wanted.filter((id) => !snap.videos[id] || now - snap.videos[id].at >= STATS_TTL_MS - TTL_SLACK_MS);
  const channelStale = !snap.channel || now - snap.channel.at >= CHANNEL_TTL_MS;
  if ((!stale.length && !channelStale) || now < blockedUntil) return snap;

  let auth: string;
  try {
    const yt = await getYoutubeAuth();
    if (!yt) return snap;
    auth = await bearer(yt.refreshToken);
  } catch (e) {
    // Token bị thu hồi: nghỉ lâu hơn, người dùng phải kết nối lại. Lỗi khác (mạng): nghỉ ngắn.
    blockedUntil = now + (e instanceof YoutubeAuthError ? 10 * 60_000 : 60_000);
    return snap;
  }

  const result: LiveStats = { videos: { ...snap.videos }, channel: snap.channel };
  try {
    if (stale.length) {
      const fresh = await fetchVideoStats(stale, auth);
      if (Object.keys(fresh).length) {
        Object.assign(result.videos, fresh);
        await saveSnapshot(STATS_KEY, result.videos);
      }
    }
    if (channelStale && Date.now() >= blockedUntil) {
      const channel = await fetchChannelStat(auth);
      if (channel) {
        result.channel = channel;
        await saveSnapshot(CHANNEL_STATS_KEY, channel);
      }
    }
  } catch (e) {
    blockedUntil = Date.now() + 60_000;
    console.warn("Không lấy được số liệu YouTube:", e instanceof Error ? e.message : e);
  }
  return result;
}

/**
 * Số liệu YouTube mới nhất: nhớ 60 giây trong bộ nhớ, gộp các lượt gọi đồng thời, và chỉ gọi API cho id đã cũ hơn 60 giây
 * (snapshot trong DB chung giữa các instance nên nhiều tab/instance không nhân quota). Lỗi → trả số cũ, không ném.
 */
export async function loadLiveStats(extraIds: string[] = []): Promise<LiveStats> {
  if (mem && Date.now() - mem.at < STATS_TTL_MS && extraIds.every((id) => mem!.stats.videos[id])) return mem.stats;
  inflight ??= refresh(extraIds)
    .then((stats) => {
      mem = { stats, at: Date.now() };
      return stats;
    })
    .catch(() => mem?.stats ?? emptyStats())
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
