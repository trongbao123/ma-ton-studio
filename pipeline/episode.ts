// Nội dung của "tập ngày": meta/SEO vidIQ, mục lục chương + mục lục con, thumbnail, Short kịch tính nhất.
// Dựng video (concat) nằm ở compile.ts; file này chỉ làm phần chữ + ảnh.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Chapter, Series, VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { AI_NOTE, optimizeMeta } from "@/lib/seo-optimize";
import { composeDescription, hashtagsFor, headings, segmentsFromText } from "./description";
import { buildEpisodeToc, ensureEpisodeLabel, fullLabel } from "./episode-plan";
import { playlistUrl, seriesPlaylist } from "./playlist";
import { scenePrompts } from "./prompts";
import { buildVideo, musicCredit, narrate, pickMusic, splitScenes, thumbnail } from "./render";
import { generateTitles, genreSeeds, keywordResearch, scoreTitles } from "./vidiq";

const SHORT_SCENES = 5;

export type EpisodeInput = {
  s: Series;
  /** Chương của tập theo thứ tự, kèm thời lượng video chương (giây). */
  chapters: { chapter: Chapter; seconds: number }[];
  episodeNo: number;
  from: number;
  to: number;
  dir: string;
  videoId: number;
  /** Ghi công nhạc nền gom từ các video chương. */
  credits: string[];
  previousEpisodeUrl: string | null;
  compilation: NonNullable<VideoMeta["compilation"]>;
};

const episodeSchema = z.object({
  title: z.string().describe("Tiêu đề YouTube 50–70 ký tự kiểu kênh truyện audio lớn: mở bằng HOOK gây sốc/tò mò về khoảnh khắc gay cấn nhất (không spoil kết), chứa 1 từ khóa tìm kiếm điểm cao, kết bằng nhãn 'FULL …H' hoặc 'Tập N (Chương X–Y)'; viết hoa chữ cái đầu như câu thường"),
  titleAlternatives: z.array(z.string()).describe("2 phương án tiêu đề khác, hook khác nhau, cùng yêu cầu"),
  description: z.string().describe("Mô tả 220–300 từ, 3–4 đoạn (KHÔNG kèm mục lục, hệ thống tự thêm): câu đầu chứa tên truyện; giới thiệu hấp dẫn các chương trong tập, không spoil kết; nhắc tên truyện ≥ 2 lần; kêu gọi đăng ký/like/bật chuông"),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt và không dấu, tổng 300–480 ký tự; tag đầu là từ khóa điểm cao nhất, có tên truyện; không trùng"),
  thumbnailText: z.string().describe("Chữ trên thumbnail 2–3 từ IN HOA, cảm xúc mạnh, KHÔNG lặp số tập"),
  thumbnailPrompt: z.string().describe("English image prompt for a YouTube thumbnail: extreme close-up of the main character's face at the most dramatic moment, glowing eyes or energy, focal point on the RIGHT half, darker simpler LEFT third for text, high contrast"),
  characterLook: z.string().describe("English: ngoại hình nhân vật chính"),
  shortTitle: z.string().describe("Tiêu đề Short ≤ 60 ký tự, có tên truyện, có #shorts"),
  shortDescription: z.string().describe("1–2 câu có tên truyện, mời xem tập full trên kênh, kèm #shorts"),
  shortScript: z.string().describe("Lời đọc Short 60–90 giây (170–230 từ): hook cực mạnh câu đầu, kể khoảnh khắc KỊCH TÍNH nhất trong 3 chương, dừng ở cao trào, câu cuối mời xem tập full"),
});

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

async function writeMeta(o: EpisodeInput, seoText: string | null, total: number) {
  const body = o.chapters.map(({ chapter: c }) => `Chương ${c.number}: ${c.title}\n  Tóm tắt: ${clip(c.summary, 600)}\n  Đoạn cuối: ${clip(c.content.slice(-1500), 1500)}`).join("\n\n");
  return textProvider().generateJson({
    system: "Bạn là chuyên gia YouTube kênh truyện audio tiên hiệp Việt Nam, tối ưu CTR và watch time.",
    prompt: `Đây là TẬP ${o.episodeNo} dài ${(total / 3600).toFixed(1)} giờ (nhãn '${fullLabel(total)}'), nghe liền mạch chương ${o.from}–${o.to}.\n\nTruyện: ${o.s.title}\nCốt truyện: ${o.s.premise}\nNhân vật/bối cảnh:\n${o.s.bible.slice(0, 2000)}\n\n${body}${
      seoText ? `\n\nTừ khóa người xem Việt Nam tìm thật (vidIQ, xếp theo điểm). Tiêu đề PHẢI chứa 1 từ khóa top đầu; mô tả và tag đầu dùng từ khóa điểm cao:\n${seoText}` : ""
    }`,
    schema: episodeSchema,
    temperature: 0.8,
    tier: "quality",
    task: "meta",
  });
}

/** Short 60–90 giây từ lời đọc kịch tính nhất; lỗi/hết quota thì bỏ Short, không làm hỏng tập. */
async function makeShort(o: EpisodeInput, m: z.infer<typeof episodeSchema>, music: string | null) {
  try {
    const dir = path.join(o.dir, "short");
    await mkdir(dir, { recursive: true });
    const narration = await narrate(m.shortScript, dir, o.s.ttsVoice, undefined, 34);
    const scenes = splitScenes(narration.cues, SHORT_SCENES, narration.seconds);
    const raw = await scenePrompts(m.characterLook, scenes.map((x) => x.text));
    const video = await buildVideo({
      dir, name: "short", narration, scenes, music,
      prompts: raw.map((p) => ({ ...p, prompt: `${p.prompt}, vertical portrait composition` })),
      w: 1080, h: 1920, imgW: 768, imgH: 1408, fontSize: 80, marginV: 520, hook: m.thumbnailText, progressBar: true,
    });
    return video.out;
  } catch (e) {
    console.warn(`⚠ Bỏ qua Short${e instanceof QuotaExhaustedError ? " (hết quota)" : ""}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export async function buildEpisodeContent(o: EpisodeInput) {
  const durations = o.chapters.map((c) => c.seconds);
  const total = durations.reduce((a, b) => a + b, 0);
  const seo = await keywordResearch(genreSeeds(o.s.genre));
  const keywords = seo?.keywords.map((k) => k.keyword) ?? [];
  console.log(`  Từ khóa: ${seo?.keywords.slice(0, 6).map((k) => `${k.keyword} (${k.overall})`).join(", ") ?? "không có"}`);
  const m = await writeMeta(o, seo?.text ?? null, total);
  console.log(`  Meta bởi ${textProvider().lastModel}`);

  const options = [m.title, ...(m.titleAlternatives ?? [])].filter(Boolean);
  const scores = await scoreTitles(options);
  const ideas = await generateTitles(m.title, m.description);
  const all = [...options.map((t, i) => ({ title: t, score: scores?.[i] ?? null })), ...ideas.filter((x) => !options.includes(x.title))];
  for (const x of all) console.log(`  ${x.score ?? "?"} — ${x.title}`);
  const best = all.reduce((b, x) => ((x.score ?? -1) > (b.score ?? -1) ? x : b));
  const title = ensureEpisodeLabel(best.title, o);

  const music = await pickMusic(o.videoId);
  const draft: VideoMeta = {
    title, description: `${m.description}\n\n${AI_NOTE}`, tags: m.tags,
    shortTitle: m.shortTitle, shortDescription: m.shortDescription,
    seo: { titleScore: best.score, titleOptions: all, keywords }, compilation: o.compilation,
  };
  const fixed = await optimizeMeta(
    draft,
    { seriesTitle: o.s.title, chapterNumber: o.to, chapterTitle: `tập ${o.episodeNo}, chương ${o.from}–${o.to}, nghe liền mạch`, summary: o.chapters.map((c) => c.chapter.summary).filter(Boolean).join("\n") },
    { log: console.log },
  );

  // Mục lục: mỗi chương một mốc + mục con theo tỉ lệ nội dung (video chương không lưu phụ đề).
  const items = [];
  for (const { chapter: c, seconds } of o.chapters) {
    const segs = segmentsFromText(c.content, seconds);
    const names = await headings(segs).catch(() => segs.map((_, i) => (i === 0 ? "Mở đầu" : `Phần ${i + 1}`)));
    items.push({ number: c.number, title: c.title, seconds, sub: segs.map((sg, i) => ({ start: sg.start, title: names[i] })) });
  }
  const pl = await seriesPlaylist(o.s.id).catch(() => null);
  const links = [
    ...(pl ? [`📜 Nghe trọn bộ theo thứ tự: ${playlistUrl(pl)}`] : []),
    ...(o.previousEpisodeUrl ? [`⏮ Tập trước: ${o.previousEpisodeUrl}`] : []),
  ];
  const description = composeDescription(fixed.meta.description, buildEpisodeToc(items), links, hashtagsFor(keywords), o.credits.join("\n\n"));
  const credit = music ? `\n\n${musicCredit(music)}` : "";
  const meta: VideoMeta = { ...fixed.meta, title, description, shortDescription: `${fixed.meta.shortDescription}${credit}`, compilation: o.compilation };
  console.log(`  Điểm SEO: ${fixed.score}; tiêu đề: ${meta.title}`);

  console.log("● Thumbnail");
  const thumb = await thumbnail(o.dir, `${m.thumbnailPrompt}, ${m.characterLook}`, m.thumbnailText, `TẬP ${o.episodeNo}`).catch((e) => {
    console.warn("⚠ Thumbnail AI lỗi — đăng không thumbnail:", e instanceof Error ? e.message : e);
    return null;
  });
  console.log("● Short");
  const short = await makeShort(o, m, music);
  return { meta, thumb, short };
}
