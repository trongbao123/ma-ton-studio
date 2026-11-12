// Bật "Thần Ấn là hệ thống" cho một bộ truyện: ghi luật vào bible + giọng văn, rồi trả các chương đã viết mà CHƯA có video
// về dàn ý để daily viết lại theo luật mở đầu mới (chưa đọc giọng nên không mất lượt TTS). CLI: render.ts "hethong:<seriesId>".
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { resettableChapters, SYSTEM_STYLE, withSystemSection } from "@/lib/story/system";

export async function applySystem(seriesId: number) {
  await loadSecrets(true);
  const [s] = await db().select().from(series).where(eq(series.id, seriesId));
  if (!s) throw new Error(`Không có bộ truyện #${seriesId}`);
  const bible = withSystemSection(s.bible);
  await db().update(series).set({ bible, style: SYSTEM_STYLE }).where(eq(series.id, seriesId));
  console.log(bible === s.bible ? "  Bible đã có mục hệ thống — giữ nguyên" : "✔ Đã thêm mục THẦN ẤN — HỆ THỐNG vào bible");

  const list = await db().select({ id: chapters.id, number: chapters.number, title: chapters.title, status: chapters.status }).from(chapters).where(eq(chapters.seriesId, seriesId));
  // Mọi row video (kể cả lỗi/đang chờ) đều tính là "đã có video" — thà giữ một chương còn hơn xoá chương đã tốn lượt giọng đọc.
  const withVideo = list.length
    ? new Set((await db().select({ chapterId: videos.chapterId }).from(videos).where(inArray(videos.chapterId, list.map((c) => c.id)))).map((v) => v.chapterId))
    : new Set<number>();
  const reset = resettableChapters(list, withVideo).sort((a, b) => a.number - b.number);
  for (const c of reset) {
    await db().update(chapters).set({ content: "", summary: "", status: "outline", updatedAt: new Date() }).where(eq(chapters.id, c.id));
    console.log(`  ↺ Chương ${c.number} — ${c.title}: trả về dàn ý, sẽ viết lại theo luật mới`);
  }
  console.log(`✔ Xong: ${reset.length} chương trả về dàn ý; giọng văn: ${SYSTEM_STYLE}`);
}
