// Làm lại SEO (tiêu đề / mô tả / tag) cho video ĐÃ lên YouTube theo cách mới: từ khóa thật vidIQ (VN) + vidIQ chấm tiêu đề,
// rồi cập nhật thẳng lên YouTube. Không render lại video. Chạy: render.yml với video_id = "seo:<id>".
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type VideoMeta } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { scoreMeta, totalScore } from "@/lib/flow/seo";
import { AI_NOTE, optimizeMeta } from "@/lib/seo-optimize";
import { loadSecrets } from "@/lib/secrets";
import { updateYoutubeSnippet } from "@/lib/youtube";
import { enrichDescription, segmentsFromText } from "./description";
import { playlistUrl, seriesPlaylist } from "./playlist";
import { videoMeta } from "./prompts";
import { closeVidiq, genreSeeds, keywordResearch, pickBestTitle } from "./vidiq";

export async function redoSeo(videoId: number) {
  await loadSecrets(true);
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v?.meta) throw new Error(`Video #${videoId} chưa có meta.`);
  const [c] = await db().select().from(chapters).where(eq(chapters.id, v.chapterId));
  const [s] = await db().select().from(series).where(eq(series.id, c.seriesId));
  const before = totalScore(scoreMeta(v.meta, s.title));
  console.log(`▶ SEO video #${videoId} — chương ${c.number}. Tiêu đề cũ: ${v.meta.title}`);

  const seo = await keywordResearch(genreSeeds(s.genre));
  const keywords = seo?.keywords.map((k) => k.keyword) ?? [];
  console.log(`  Từ khóa: ${seo?.keywords.slice(0, 6).map((k) => `${k.keyword} (${k.overall})`).join(", ") ?? "không có"}`);
  const m = await videoMeta(s, c, seo?.text);
  console.log(`  Meta mới bởi ${textProvider().lastModel}`);

  // Giữ cả tiêu đề đang dùng làm ứng viên: làm lại không bao giờ được ra tiêu đề điểm thấp hơn.
  // Cả các tiêu đề từng chấm ở lần trước (vd bản 89 điểm bị thay nhầm) cũng là ứng viên.
  const past = (v.meta.seo?.titleOptions ?? []).filter((x) => (x.score ?? 0) >= 80).map((x) => x.title);
  const options = [...new Set([v.meta.title, ...past, m.title, ...(m.titleAlternatives ?? [])].filter(Boolean))];
  const picked = await pickBestTitle(options, m.description);
  const all = picked?.all ?? options.map((title) => ({ title, score: null }));
  for (const x of all) console.log(`  ${x.score ?? "?"} — ${x.title}`);
  const top = picked?.best ?? all[0];
  // Tiêu đề vidIQ gợi ý hay thiếu số chương → gắn thêm nếu còn chỗ (≤ 100 ký tự).
  const tail = ` | Chương ${c.number}`;
  const best = /chương\s*\d+/i.test(top.title) || top.title.length + tail.length > 100 ? top : { ...top, title: `${top.title}${tail}` };

  // Giữ phần ghi công nhạc (nếu có) ở cuối mô tả cũ.
  const credit = v.meta.description.match(/\n\nNhạc nền:[\s\S]*$/)?.[0] ?? "";
  const draft: VideoMeta = {
    ...v.meta,
    title: best.title.length > 100 ? `${best.title.slice(0, 97)}…` : best.title,
    description: `${m.description}\n\n${AI_NOTE}`,
    tags: m.tags,
    shortTitle: m.shortTitle,
    shortDescription: m.shortDescription,
    seo: { titleScore: best.score, titleOptions: all, keywords },
  };
  const fixed = await optimizeMeta(draft, { seriesTitle: s.title, chapterNumber: c.number, chapterTitle: c.title, summary: c.summary }, { log: console.log });
  const pl = await seriesPlaylist(s.id);
  const meta = await enrichDescription(
    { ...fixed.meta, description: `${fixed.meta.description}${credit}` },
    {
      segments: segmentsFromText(c.content, v.durationSec ?? 900), seriesId: s.id, chapterNumber: c.number,
      keywords, links: pl ? [`📜 Nghe trọn bộ theo thứ tự: ${playlistUrl(pl)}`] : [],
    },
  );
  console.log(`  Điểm SEO app: ${before} → ${fixed.score}; vidIQ tiêu đề: ${best.score ?? "?"}`);

  if (v.youtubeVideoId) {
    await updateYoutubeSnippet(v.youtubeVideoId, { title: meta.title, description: meta.description, tags: meta.tags });
    console.log(`  ✔ Đã cập nhật YouTube ${v.youtubeVideoId}`);
  }
  await db().update(videos).set({ meta, updatedAt: new Date() }).where(eq(videos.id, videoId));
  console.log(`✔ Tiêu đề mới: ${meta.title}\nTag: ${meta.tags.join(", ")}`);
  await closeVidiq();
}
