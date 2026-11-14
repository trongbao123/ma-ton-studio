import { and, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { occupiesDailySlot, pickPublishSlot } from "./episode-plan";

/** Giờ đăng video chương: 15h giờ Việt Nam = 08h UTC (đổi giờ thì sửa ở đây). */
export const PUBLISH_HOUR_UTC = 8;

/** Khung giờ đăng tiếp theo: 15h giờ Việt Nam, mỗi ngày 1 video (chương hoặc tập), bắt đầu từ hôm nay (hoặc mai nếu còn < 2 tiếng). */
export async function nextPublishSlot(now = new Date()) {
  const taken = await db()
    .select({ at: videos.publishAt, meta: videos.meta })
    .from(videos)
    .where(and(isNotNull(videos.publishAt), gte(videos.publishAt, now)));
  // Bản gộp 5 chương cũ có khung riêng (12h VN) — không chiếm ngày; tập ngày thì chiếm.
  return pickPublishSlot(taken.filter((t) => occupiesDailySlot(t.meta)).map((t) => t.at!), PUBLISH_HOUR_UTC, now);
}

/** Giữ lịch cũ nếu còn ở tương lai (≥ 15 phút), không thì lấy khung giờ mới — render lại muộn không đăng vào giờ đã qua. */
export async function keepOrNextSlot(current: Date | null) {
  return current && current.getTime() > Date.now() + 15 * 60_000 ? current : nextPublishSlot();
}

/** Dời lịch các video chương đã lên lịch ở tương lai về đúng giờ PUBLISH_HOUR_UTC cùng ngày (DB + YouTube nếu đã upload). */
export async function rescheduleToPublishHour() {
  const { loadSecrets } = await import("@/lib/secrets");
  const { updateYoutubePublishAt } = await import("@/lib/youtube");
  const { eq } = await import("drizzle-orm");
  await loadSecrets(true);
  const rows = await db()
    .select({ id: videos.id, at: videos.publishAt, yt: videos.youtubeVideoId, short: videos.youtubeShortId, meta: videos.meta })
    .from(videos)
    .where(and(isNotNull(videos.publishAt), gte(videos.publishAt, new Date())));
  // Giữ thứ tự cũ, mỗi ngày 1 video: giờ mới đã qua thì giữ nguyên lịch cũ (không đẩy sang ngày đã có video).
  const list = rows.filter((x) => !x.meta?.compilation && !x.meta?.shortClip).sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const used = new Set<string>();
  for (const r of list) {
    const at = new Date(r.at!);
    at.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    const day = at.toISOString().slice(0, 10);
    if (at.getTime() < Date.now() + 15 * 60_000 || used.has(day)) {
      used.add(r.at!.toISOString().slice(0, 10));
      continue;
    }
    used.add(day);
    if (r.at!.getTime() === at.getTime()) continue;
    if (r.yt) await updateYoutubePublishAt(r.yt, at);
    if (r.short) await updateYoutubePublishAt(r.short, new Date(at.getTime() + 2 * 3600_000)).catch((e) => console.warn(`  Short #${r.id}:`, e instanceof Error ? e.message : e));
    await db().update(videos).set({ publishAt: at }).where(eq(videos.id, r.id));
    console.log(`  #${r.id} → ${at.toISOString()}`);
  }
}

/** Đặt lịch đăng cụ thể cho 1 video (DB + YouTube). Dùng sửa tay: CLI "setpublish:<id>:<ISO>". */
export async function setPublishAt(videoId: number, at: Date) {
  const { loadSecrets } = await import("@/lib/secrets");
  const { updateYoutubePublishAt } = await import("@/lib/youtube");
  const { eq } = await import("drizzle-orm");
  await loadSecrets(true);
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (v.youtubeVideoId) await updateYoutubePublishAt(v.youtubeVideoId, at);
  if (v.youtubeShortId) await updateYoutubePublishAt(v.youtubeShortId, new Date(at.getTime() + 2 * 3600_000)).catch(() => {});
  await db().update(videos).set({ publishAt: at }).where(eq(videos.id, videoId));
  console.log(`  #${videoId} → ${at.toISOString()}`);
}

/**
 * Giữ lại tập chưa đạt chuẩn: video + Short về riêng tư, bỏ lịch công chiếu, tập đánh dấu lỗi "chờ dựng lại"
 * → các chương được giải phóng để ghép lại (compile tự thử lại). Không xoá gì trên YouTube.
 */
export async function holdEpisodes(ids: number[]) {
  const { loadSecrets } = await import("@/lib/secrets");
  const { holdYoutubeVideo } = await import("@/lib/youtube");
  const { eq } = await import("drizzle-orm");
  await loadSecrets(true);
  for (const id of ids) {
    const [v] = await db().select().from(videos).where(eq(videos.id, id));
    if (!v) continue;
    if (v.publishAt && v.publishAt < new Date()) {
      console.log(`  #${id} đã công chiếu — bỏ qua`);
      continue;
    }
    for (const yt of [v.youtubeVideoId, v.youtubeShortId]) if (yt) await holdYoutubeVideo(yt);
    await db()
      .update(videos)
      .set({ publishAt: null, status: "failed", error: "Giữ lại (riêng tư): chưa đạt chuẩn — chờ dựng lại có đoạn mở đầu + nhịp mới", updatedAt: new Date() })
      .where(eq(videos.id, id));
    console.log(`  #${id} → riêng tư, bỏ lịch (${v.youtubeVideoId ?? "-"} / Short ${v.youtubeShortId ?? "-"})`);
  }
}

/**
 * Job "ngâm rồi lên lịch": mọi tập còn riêng tư (chưa tới giờ công chiếu) được xếp lại theo vòng xoay các bộ đang chạy
 * (mỗi ngày một bộ, bộ chưa có tập thì nhường lượt). Chỉ đổi những tập bị lệch; tập sắp chiếu trong < 2 giờ giữ nguyên.
 * Chạy cuối mỗi lượt daily (sau khi dựng tập mới) và CLI "rotate".
 */
export async function rotateSchedule(now = new Date()) {
  const { loadSecrets } = await import("@/lib/secrets");
  const { updateYoutubePublishAt } = await import("@/lib/youtube");
  const { asc, eq, gt, lt, desc } = await import("drizzle-orm");
  const { series } = await import("@/db/schema");
  const { planRotation } = await import("./episode-plan");
  await loadSecrets(true);
  const firstDay = pickPublishSlot([], PUBLISH_HOUR_UTC, now);
  const rows = await db()
    .select({ id: videos.id, at: videos.publishAt, yt: videos.youtubeVideoId, short: videos.youtubeShortId, meta: videos.meta })
    .from(videos)
    .where(and(isNotNull(videos.publishAt), gte(videos.publishAt, firstDay)));
  const episodes = rows.filter((r) => r.meta?.compilation?.episode && !r.meta.shortClip);
  if (!episodes.length) return;
  // Ngày đã có video khác (video chương lẻ…) chiếm thì không xếp tập vào.
  const blockedDays = new Set(rows.filter((r) => occupiesDailySlot(r.meta) && !r.meta?.compilation?.episode).map((r) => r.at!.toISOString().slice(0, 10)));
  const order = (
    await db().select({ id: series.id }).from(series).where(and(eq(series.autopilot, true), gt(series.episodeChapters, 0))).orderBy(asc(series.id))
  ).map((s) => s.id);
  // Bộ vừa lên sóng gần nhất → lượt kế tiếp là bộ sau nó.
  const [last] = (
    await db().select({ at: videos.publishAt, meta: videos.meta }).from(videos).where(and(isNotNull(videos.publishAt), lt(videos.publishAt, firstDay))).orderBy(desc(videos.publishAt)).limit(20)
  ).filter((r) => r.meta?.compilation?.episode);
  const plan = planRotation({
    episodes: episodes.map((e) => ({ id: e.id, seriesId: e.meta!.compilation!.seriesId, episodeNo: e.meta!.compilation!.episodeNo ?? e.meta!.compilation!.to })),
    order, lastSeries: last?.meta?.compilation?.seriesId ?? null, firstDay, blockedDays,
  });
  for (const e of episodes) {
    const at = plan.get(e.id)!;
    if (at.getTime() === e.at!.getTime()) continue;
    if (e.yt) await updateYoutubePublishAt(e.yt, at);
    if (e.short) await updateYoutubePublishAt(e.short, new Date(at.getTime() + 2 * 3600_000)).catch((err) => console.warn(`  Short #${e.id}:`, err instanceof Error ? err.message : err));
    await db().update(videos).set({ publishAt: at }).where(eq(videos.id, e.id));
    console.log(`  🔁 tập #${e.id} (bộ #${e.meta!.compilation!.seriesId}, tập ${e.meta!.compilation!.episodeNo ?? "?"}) → ${at.toISOString()}`);
  }
}
