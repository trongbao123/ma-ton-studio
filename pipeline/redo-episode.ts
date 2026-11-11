// Dựng lại 1 tập CHƯA công chiếu theo cách mới (mở đầu cao trào, 3 thumbnail vidIQ): xoá bản trên YouTube (video + Short),
// đánh dấu row cũ hỏng để các chương được ghép lại, rồi ghép tập mới và đăng theo lịch. CLI: render.ts "redo:<videoId>[:<ISO lịch>]".
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { accessToken, getYoutubeAuth } from "@/lib/youtube";
import { compileSeries } from "./compile";
import { setPublishAt } from "./schedule";

async function deleteYoutube(id: string, token: string) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok && res.status !== 404) throw new Error(`Xoá ${id} lỗi: ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log(`  🗑 Đã xoá youtu.be/${id}`);
}

export async function redoEpisode(videoId: number, publishAt?: Date, full = false) {
  await loadSecrets(true);
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v?.meta?.compilation?.episode) throw new Error(`Video #${videoId} không phải tập.`);
  if (v.publishAt && v.publishAt < new Date()) throw new Error("Tập đã công chiếu — không xoá (mất view).");
  const auth = await getYoutubeAuth();
  if (!auth) throw new Error("Chưa kết nối YouTube.");
  const token = await accessToken(auth.refreshToken);
  for (const id of [v.youtubeVideoId, v.youtubeShortId]) if (id) await deleteYoutube(id, token);
  await db()
    .update(videos)
    .set({ status: "failed", error: "Dựng lại theo cách mới", youtubeVideoId: null, youtubeUrl: null, youtubeShortId: null, publishAt: null, updatedAt: new Date() })
    .where(eq(videos.id, videoId));
  // full: render lại cả các chương trong tập theo cách mới (2 phút đầu ảnh 6 giây + zoom) — tốn ~8 lượt giọng/chương.
  if (full) {
    const { renderVideo } = await import("./render");
    for (const id of v.meta.compilation.videoIds) {
      console.log(`▶ Render lại chương nội bộ #${id}`);
      await db().update(videos).set({ status: "queued", error: null }).where(eq(videos.id, id));
      await renderVideo(id);
    }
  }
  const [c] = await db().select({ seriesId: chapters.seriesId }).from(chapters).where(eq(chapters.id, v.chapterId));
  await compileSeries(c.seriesId);
  if (publishAt) {
    const [fresh] = await db().select({ id: videos.id }).from(videos).where(eq(videos.chapterId, v.chapterId)).orderBy(videos.id);
    const all = await db().select({ id: videos.id, meta: videos.meta }).from(videos).where(eq(videos.chapterId, v.chapterId));
    const latest = all.filter((x) => x.meta?.compilation?.episode).sort((a, b) => b.id - a.id)[0] ?? fresh;
    if (latest && latest.id !== videoId) await setPublishAt(latest.id, publishAt);
  }
}
