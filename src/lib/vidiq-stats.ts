// Số liệu THẬT của từng video lấy từ vidIQ (nguồn của trang vidIQ chính thức), chạy trong Vercel Cron /api/cron/daily:
// - CTR + lượt hiển thị thumbnail: đọc YouTube Studio qua extension vidIQ trên trình duyệt chủ kênh (chưa mở trình duyệt thì
//   vidIQ trả jobId, lượt cron sau đọc tiếp — không tốn thêm credit).
// - Lượt xem, thời gian xem TB, % xem TB: YouTube Analytics qua vidIQ.
// Mỗi lần lấy ~10 credit; tài khoản còn ít (11/2026: 285 credit tới 6/12) nên mặc định 3 ngày/lần (VIDIQ_STATS_EVERY_HOURS).
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, chapters, series, videos } from "@/db/schema";
import { CHANNEL_ID } from "./channel";

export const VIDIQ_STATS_KEY = "vidiq_stats";
export const STATS_EVERY_MS = Number(process.env.VIDIQ_STATS_EVERY_HOURS ?? 72) * 3600_000;

export type VidiqVideoStat = { impressions?: number; ctr?: number; views?: number; avgViewSec?: number; avgViewPct?: number };
export type VidiqStats = { at: number | null; pendingJob: string | null; videos: Record<string, VidiqVideoStat>; note?: string | null };

const json = (text: string | null): Record<string, unknown> | null => {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Kết quả báo cáo thumbnail_ctr: số từng video, hoặc jobId nếu vidIQ đang chờ trình duyệt. */
export function parseCtr(text: string | null): { job: string | null; rows: Record<string, VidiqVideoStat>; error?: string } {
  const j = json(text);
  if (!j) return text?.trim() ? { job: null, rows: {}, error: text.trim().slice(0, 200) } : { job: null, rows: {} };
  if (j.status === "waiting_for_browser" && typeof j.jobId === "string") return { job: j.jobId, rows: {} };
  if (j.errorCode || (j.status && j.status !== "completed")) {
    return { job: null, rows: {}, error: [j.errorCode ?? j.status, j.message].filter(Boolean).join(": ").slice(0, 200) };
  }
  const list = ((j.result as { videos?: unknown[] } | undefined)?.videos ?? []) as { videoId?: string; thumbnailImpressions?: number | null; thumbnailCtrPercentage?: number | null }[];
  const rows: Record<string, VidiqVideoStat> = {};
  for (const v of list) {
    if (!v.videoId || v.thumbnailImpressions == null || v.thumbnailCtrPercentage == null) continue;
    rows[v.videoId] = { impressions: v.thumbnailImpressions, ctr: v.thumbnailCtrPercentage };
  }
  return { job: null, rows };
}

/** Bảng YouTube Analytics (dimension video): đọc theo tên cột. */
export function parseAnalytics(text: string | null): Record<string, VidiqVideoStat> {
  const j = json(text);
  const cols = ((j?.columnHeaders ?? []) as { name: string }[]).map((c) => c.name);
  const at = (n: string) => cols.indexOf(n);
  const out: Record<string, VidiqVideoStat> = {};
  for (const r of (j?.rows ?? []) as unknown[][]) {
    const id = r[at("video")];
    if (typeof id !== "string") continue;
    const num = (n: string) => (at(n) >= 0 && typeof r[at(n)] === "number" ? (r[at(n)] as number) : undefined);
    out[id] = { views: num("views"), avgViewSec: num("averageViewDuration"), avgViewPct: num("averageViewPercentage") };
  }
  return out;
}

export const isDue = (last: number | null, now: number) => last == null || now - last >= STATS_EVERY_MS;

/** Gộp lượt mới vào số cũ theo id YouTube; video không có trong lượt mới giữ số cũ. */
export function mergeStats(old: Record<string, VidiqVideoStat>, ctr: Record<string, VidiqVideoStat>, analytics: Record<string, VidiqVideoStat>) {
  const out = { ...old };
  for (const id of new Set([...Object.keys(ctr), ...Object.keys(analytics)])) out[id] = { ...out[id], ...ctr[id], ...analytics[id] };
  return out;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export async function readVidiqStats(): Promise<VidiqStats> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, VIDIQ_STATS_KEY));
  return (row?.value as VidiqStats | undefined) ?? { at: null, pendingJob: null, videos: {} };
}

async function save(value: VidiqStats) {
  await db().insert(appSettings).values({ key: VIDIQ_STATS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Đánh dấu "CTR chưa đọc được, lượt cron sau gửi báo cáo mới" (khác jobId: job thì đọc tiếp). */
export const RETRY = "retry";

/** Việc CTR còn treo cho lượt sau: jobId đang chờ trình duyệt, RETRY nếu chưa đọc được, null nếu xong. */
export function nextPending(ctr: ReturnType<typeof parseCtr>) {
  if (ctr.job) return ctr.job;
  return Object.keys(ctr.rows).length ? null : RETRY;
}

/** Tham số gọi báo cáo CTR: đọc tiếp job đang chờ, hoặc gửi báo cáo mới 28 ngày gần nhất. */
export function ctrArgs(pending: string | null, ids: string[], now: number) {
  if (pending && pending !== RETRY) return { jobId: pending };
  return { report: "thumbnail_ctr", channelId: CHANNEL_ID, videoIds: ids, startDate: day(now - 28 * 86400_000), endDate: day(now + 86400_000) };
}

/** Lấy số nếu tới hạn (hoặc CTR còn treo). Trả 1 dòng mô tả cho log cron. Không ném lỗi. */
export async function syncVidiqStats(now = Date.now(), force = false): Promise<string> {
  try {
    const { loadSecrets } = await import("./secrets");
    await loadSecrets();
    if (!process.env.VIDIQ_API_KEY) return "vidIQ: chưa có VIDIQ_API_KEY — bỏ qua";
    const state = await readVidiqStats();
    const due = force || isDue(state.at, now);
    if (!due && !state.pendingJob) return "vidIQ: chưa tới hạn lấy số";
    // vidIQ chỉ gắn với kênh gốc — video kênh phụ không lấy số ở đây.
    const ids = (
      await db()
        .select({ id: videos.youtubeVideoId })
        .from(videos)
        .innerJoin(chapters, eq(chapters.id, videos.chapterId))
        .innerJoin(series, eq(series.id, chapters.seriesId))
        .where(and(isNotNull(videos.youtubeVideoId), eq(series.channel, "main")))
        .orderBy(videos.id)
    )
      .map((r) => r.id!)
      .slice(-50);
    if (!ids.length) return "vidIQ: chưa có video trên YouTube";
    const { callVidiq, closeVidiq } = await import("../../pipeline/vidiq");
    try {
      const ctr = parseCtr(
        await callVidiq("vidiq_channel_analytics_extended", ctrArgs(state.pendingJob, ids, now)).catch((e) => (console.warn("vidIQ CTR lỗi:", e instanceof Error ? e.message : e), null)),
      );
      const analytics = due
        ? parseAnalytics(
            await callVidiq("vidiq_channel_analytics", {
              channelId: CHANNEL_ID,
              dimensions: ["video"],
              metrics: ["views", "averageViewDuration", "averageViewPercentage"],
              startDate: day(now - 90 * 86400_000),
              sort: "-views",
              maxResults: 50,
            }).catch((e) => (console.warn("vidIQ analytics lỗi:", e instanceof Error ? e.message : e), null)),
          )
        : {};
      const note = ctr.job ? "CTR đang chờ trình duyệt có extension vidIQ mở — lượt sau đọc tiếp" : ctr.error ? `CTR: ${ctr.error}` : null;
      await save({ at: due ? now : state.at, pendingJob: nextPending(ctr), videos: mergeStats(state.videos, ctr.rows, analytics), note });
      return `vidIQ: CTR ${Object.keys(ctr.rows).length} video, analytics ${Object.keys(analytics).length} video${note ? ` (${note})` : ""}`;
    } finally {
      await closeVidiq().catch(() => {});
    }
  } catch (e) {
    return `vidIQ: lỗi ${e instanceof Error ? e.message.slice(0, 200) : e}`;
  }
}
