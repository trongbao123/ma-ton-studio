// Làm lại thumbnail cho video ĐÃ lên YouTube theo kiểu mới: 3 phương án (cận mặt / đối đầu / bùng nổ) + nhãn FULL,
// vidIQ chấm rồi đặt cái điểm cao nhất. Không đụng video. CLI: render.ts "thumbs:<videoId>".
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { loadSecrets } from "@/lib/secrets";
import { accessToken, getYoutubeAuth } from "@/lib/youtube";
import { fullBadge } from "./episode-plan";
import { Tracker } from "./progress";
import { heroRef } from "./hero";
import { ensureRelease, uploadAsset } from "./release";
import { thumbnail } from "./render";
import { THUMB_IDS, THUMB_STYLE, thumbFile, type ThumbId } from "./thumb-plan";
import { chooseThumbnail, setThumbnail } from "./youtube";
import { NO_NAME_RULE } from "@/lib/meta-rules";

export const rethumbSchema = z.object({
  thumbnailText: z.string().describe(`Chữ trên thumbnail 2–3 từ IN HOA, cảm xúc mạnh; ${NO_NAME_RULE}`),
  a: z.string().describe("English prompt A: EXTREME close-up of the main character's face filling 50-60% of the frame at the most dramatic moment, extreme expression, glowing eyes, face on the RIGHT half, plain dark LEFT third for text, very high contrast"),
  b: z.string().describe("English prompt B: the main character FACING the monster / main enemy of this video in a tense standoff, both clearly visible, high contrast, simple background, left third darker for text"),
  c: z.string().describe("English prompt C: the main character at the moment of an explosive power surge (energy blast, lightning, shockwave), fierce expression, high contrast, saturated colors, left third darker for text"),
});

export async function rethumb(videoId: number) {
  await loadSecrets(true);
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v?.meta || !v.youtubeVideoId) throw new Error(`Video #${videoId} chưa có trên YouTube.`);
  const [c] = await db().select().from(chapters).where(eq(chapters.id, v.chapterId));
  const [s] = await db().select().from(series).where(eq(series.id, c.seriesId));
  // Tập: đọc tóm tắt mọi chương trong tập; video chương lẻ: chương của nó.
  const ids = v.meta.compilation?.videoIds ?? [];
  const chs = ids.length
    ? await db().select({ number: chapters.number, title: chapters.title, summary: chapters.summary }).from(videos).innerJoin(chapters, eq(chapters.id, videos.chapterId)).where(inArray(videos.id, ids))
    : [{ number: c.number, title: c.title, summary: c.summary }];
  const dir = path.resolve(`.render/rethumb-${videoId}`);
  await mkdir(dir, { recursive: true });
  // Ngoại hình + ảnh mẫu nam chính CỐ ĐỊNH của bộ (hero.ts) — thumbnail cùng một mặt với video.
  const hero = await heroRef(s, dir);
  const look = hero.look;
  const m = await textProvider().generateJson({
    system: "Bạn là chuyên gia thumbnail YouTube kênh truyện audio tiên hiệp, tối ưu tỉ lệ bấm ở mục Video đề xuất.",
    prompt: `Truyện: ${s.title}\nTiêu đề video: ${v.meta.title}\nNhân vật chính: ${look}\n\n${chs.map((x) => `Chương ${x.number} — ${x.title}: ${x.summary}`).join("\n")}\n\nViết chữ thumbnail và 3 prompt ảnh cho 3 phương án.`,
    schema: rethumbSchema,
    temperature: 0.8,
    tier: "cheap",
    task: "meta",
  });
  const badge = fullBadge(v.durationSec ?? 0);
  const releaseId = await ensureRelease(videoId, false);
  const thumbs: { id: ThumbId; file: string }[] = [];
  for (const [i, id] of THUMB_IDS.entries()) {
    try {
      const file = await thumbnail(dir, `${m[id]}, ${THUMB_STYLE[id]}, ${look}`, m.thumbnailText, badge, { name: thumbFile(id).replace(/\.jpg$/, ""), seed: 77 + i * 101, refs: hero.file ? [hero.file] : undefined });
      await uploadAsset(videoId, releaseId, file, thumbFile(id));
      thumbs.push({ id, file });
      console.log(`  ✔ Thumbnail ${id.toUpperCase()}`);
    } catch (e) {
      console.warn(`⚠ Thumbnail ${id.toUpperCase()} lỗi:`, e instanceof Error ? e.message : e);
    }
  }
  if (!thumbs.length) throw new Error("Không vẽ được thumbnail nào.");
  const track = new Tracker(videoId, v.progress);
  const picked = await chooseThumbnail(videoId, v.youtubeVideoId, v.meta.title, thumbs, track);
  const auth = await getYoutubeAuth();
  if (!auth) throw new Error("Chưa kết nối YouTube.");
  await setThumbnail(await accessToken(auth.refreshToken), v.youtubeVideoId, picked.file);
  await uploadAsset(videoId, releaseId, picked.file, "thumbnail.jpg");
  await db().update(videos).set({ meta: { ...v.meta, thumbnailText: m.thumbnailText, thumbScores: picked.scores } }).where(eq(videos.id, videoId));
  console.log(`✔ Đã đặt thumbnail ${picked.scores.chosen.toUpperCase()} — điểm ${JSON.stringify(picked.scores)}`);
}
