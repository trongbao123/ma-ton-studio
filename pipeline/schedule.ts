import { and, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

/** Khung giờ đăng tiếp theo: 19h giờ Việt Nam, mỗi ngày 1 video dài, bắt đầu từ hôm nay (hoặc mai nếu đã qua 17h). */
export async function nextPublishSlot(now = new Date()) {
  const taken = await db()
    .select({ at: videos.publishAt })
    .from(videos)
    .where(and(isNotNull(videos.publishAt), gte(videos.publishAt, now)));
  const days = new Set(taken.map((t) => t.at!.toISOString().slice(0, 10)));
  // 19h VN = 12h UTC.
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  if (slot.getTime() - now.getTime() < 2 * 3600_000) slot.setUTCDate(slot.getUTCDate() + 1);
  while (days.has(slot.toISOString().slice(0, 10))) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}

/** Giữ lịch cũ nếu còn ở tương lai (≥ 15 phút), không thì lấy khung giờ mới — render lại muộn không đăng vào giờ đã qua. */
export async function keepOrNextSlot(current: Date | null) {
  return current && current.getTime() > Date.now() + 15 * 60_000 ? current : nextPublishSlot();
}
