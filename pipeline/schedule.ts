import { and, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

/** Giờ đăng video chương: 15h giờ Việt Nam = 08h UTC (đổi giờ thì sửa ở đây). */
export const PUBLISH_HOUR_UTC = 8;

/** Khung giờ đăng tiếp theo: 15h giờ Việt Nam, mỗi ngày 1 video chương, bắt đầu từ hôm nay (hoặc mai nếu còn < 2 tiếng). */
export async function nextPublishSlot(now = new Date()) {
  const taken = await db()
    .select({ at: videos.publishAt, meta: videos.meta })
    .from(videos)
    .where(and(isNotNull(videos.publishAt), gte(videos.publishAt, now)));
  // Bản gộp có khung riêng (12h VN) — không chiếm ngày của video chương.
  const days = new Set(taken.filter((t) => !t.meta?.compilation).map((t) => t.at!.toISOString().slice(0, 10)));
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), PUBLISH_HOUR_UTC));
  if (slot.getTime() - now.getTime() < 2 * 3600_000) slot.setUTCDate(slot.getUTCDate() + 1);
  while (days.has(slot.toISOString().slice(0, 10))) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
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
  for (const r of rows.filter((x) => !x.meta?.compilation)) {
    const at = new Date(r.at!);
    if (at.getUTCHours() === PUBLISH_HOUR_UTC) continue;
    at.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    if (at.getTime() < Date.now() + 15 * 60_000) at.setUTCDate(at.getUTCDate() + 1);
    if (r.yt) await updateYoutubePublishAt(r.yt, at);
    if (r.short) await updateYoutubePublishAt(r.short, new Date(at.getTime() + 2 * 3600_000)).catch((e) => console.warn(`  Short #${r.id}:`, e instanceof Error ? e.message : e));
    await db().update(videos).set({ publishAt: at }).where(eq(videos.id, r.id));
    console.log(`  #${r.id} → ${at.toISOString()}`);
  }
}
