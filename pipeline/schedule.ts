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
  // Giữ thứ tự cũ, mỗi ngày 1 video: giờ mới đã qua thì giữ nguyên lịch cũ (không đẩy sang ngày đã có video).
  const list = rows.filter((x) => !x.meta?.compilation).sort((a, b) => a.at!.getTime() - b.at!.getTime());
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
