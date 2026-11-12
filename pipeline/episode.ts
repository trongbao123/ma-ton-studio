// Nội dung của "tập ngày": meta/SEO vidIQ, mục lục chương + mục lục con, thumbnail, Short kịch tính nhất.
// Dựng video (concat) nằm ở compile.ts; file này chỉ làm phần chữ + ảnh.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Chapter, Series, VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { AI_NOTE, optimizeMeta } from "@/lib/seo-optimize";
import { composeDescription, hashtagsFor, headings, segmentsFromText } from "./description";
import { buildEpisodeToc, coldOpenSceneCount, ensureEpisodeLabel, fullBadge, fullLabel, shortSceneCount } from "./episode-plan";
import { duration, ffmpeg } from "./ffmpeg";
import { playlistUrl, seriesPlaylist } from "./playlist";
import { scenePrompts } from "./prompts";
import { heroRef } from "./hero";

type ScenePrompt = Awaited<ReturnType<typeof scenePrompts>>[number];
import { drawImage } from "./images";
import { motionPrompts, prepareClipImage } from "./i2v";
import { kaggleAuth, runI2v } from "./kaggle";
import { pool } from "./ffmpeg";
import { outroArgs } from "./outro";
import { sfxCutEvents, sfxTrackArgs, type SfxEvent } from "./sfx";
import { BURN_TEXT, buildVideo, FONT, LOGO_CROP, musicCredit, narrate, pickMusic, splitScenes, thumbnail } from "./render";
import { PUBLISH_HOUR_UTC } from "./schedule";
import { conformArgs } from "./still";
import { DEFAULT_THUMB, THUMB_IDS, THUMB_STYLE, thumbFile, type ThumbId } from "./thumb-plan";
import { chooseTitle, generateTitles, genreSeeds, keywordResearch, scoreTitles } from "./vidiq";
import { COLD_OPEN_RULE, HOOK_TITLE_RULE, NO_NAME_RULE } from "@/lib/meta-rules";


export type EpisodeInput = {
  s: Series;
  /** Chương của tập theo thứ tự, kèm thời lượng video chương (giây). */
  chapters: { chapter: Chapter; seconds: number }[];
  episodeNo: number;
  from: number;
  to: number;
  dir: string;
  videoId: number;
  /** Ảnh mẫu nam chính (điền trong buildEpisodeContent). */
  heroRef?: string | null;
  /** Ghi công nhạc nền gom từ các video chương. */
  credits: string[];
  previousEpisodeUrl: string | null;
  compilation: NonNullable<VideoMeta["compilation"]>;
};

export const episodeSchema = z.object({
  title: z.string().describe(`Tiêu đề YouTube 50–70 ký tự kiểu kênh truyện audio lớn: mở bằng HOOK gây sốc/tò mò về khoảnh khắc gay cấn nhất (không spoil kết), chứa 1 từ khóa tìm kiếm điểm cao, kết bằng nhãn 'FULL …H' hoặc 'Tập N (Chương X–Y)'; viết hoa chữ cái đầu như câu thường; ${HOOK_TITLE_RULE}`),
  titleAlternatives: z.array(z.string()).describe("2 phương án tiêu đề khác, hook khác nhau, cùng yêu cầu"),
  description: z.string().describe("Mô tả 220–300 từ, 3–4 đoạn (KHÔNG kèm mục lục, hệ thống tự thêm): câu đầu chứa tên truyện; giới thiệu hấp dẫn các chương trong tập, không spoil kết; nhắc tên truyện ≥ 2 lần; kêu gọi đăng ký/like/bật chuông"),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt CÓ DẤU viết y như người xem gõ tìm (vd 'truyện tu tiên', KHÔNG viết 'truyen tu tien'); ít nhất 5 tag lấy nguyên văn từ danh sách từ khóa vidIQ, tổng 300–480 ký tự; tag đầu là từ khóa điểm cao nhất, có tên truyện; không trùng"),
  thumbnailText: z.string().describe(`Chữ trên thumbnail 2–3 từ IN HOA, cảm xúc mạnh, KHÔNG lặp số tập; ${NO_NAME_RULE}`),
  thumbnailPrompt: z.string().describe("English image prompt, thumbnail A: EXTREME close-up of the main character's face filling 50-60% of the frame at the most dramatic moment, extreme expression (roaring, killing intent, terror), glowing eyes, face on the RIGHT half, plain dark LEFT third for text, very high contrast, minimal detail"),
  thumbnailPromptConfront: z.string().describe("English image prompt, thumbnail B: the main character FACING a monster / beast / main enemy of this episode in a tense standoff, both clearly visible, high contrast, simple background, left third darker for text"),
  thumbnailPromptBurst: z.string().describe("English image prompt, thumbnail C: the main character at the moment of an explosive power surge (huge energy blast, lightning, shockwave) with a fierce expression, high contrast, saturated colors, left third darker for text"),
  characterLook: z.string().describe("English: ngoại hình nhân vật chính"),
  shortTitle: z.string().describe(`Tiêu đề Short ≤ 60 ký tự, có tên truyện, có #shorts; ${HOOK_TITLE_RULE}`),
  shortDescription: z.string().describe("1–2 câu có tên truyện, mời xem tập full trên kênh, kèm #shorts"),
  coldOpen: z.string().describe(`Lời đọc MỞ ĐẦU video 30–45 giây (85–120 từ), phát ngay giây đầu tiên để giữ người xem: kể khoảnh khắc gay cấn nhất của tập như đang diễn ra trước mắt; câu đầu tiên là biến cố/hành động cụ thể (KHÔNG chào hỏi, KHÔNG đọc tên truyện, KHÔNG nói 'trong tập này'); dừng ngay trước kết quả; câu cuối gợi tò mò để nghe từ đầu, vd 'Nhưng để hiểu vì sao mọi chuyện ra nông nỗi này, phải quay về từ đầu…'; ${COLD_OPEN_RULE}`),
  hookText: z.string().optional().describe(`Chữ HOOK in hoa 3–6 từ hiện TO 2 giây đầu video, đi cùng tiếng nổ: câu sốc/tò mò về cao trào của tập (vd 'MỘT QUYỀN PHÁ NÁT THIÊN BIA', 'PHẾ VẬT GIẾT THÁNH TỬ?'), không spoil kết, không dấu chấm; ${NO_NAME_RULE}`),
  shortScript: z.string().describe("Lời đọc Short 15–20 giây (45–60 từ): hook cực mạnh câu đầu, kể khoảnh khắc KỊCH TÍNH nhất trong 3 chương, dừng ở cao trào, câu cuối mời xem tập full"),
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

/**
 * Đoạn mở đầu cao trào 30–45 giây đặt trước chương đầu của tập: ảnh chuyển động + phụ đề, ~6 giây đổi ảnh.
 * Video cũ mở bằng câu đọc tên truyện trên 1 ảnh đứng yên → người xem từ đề xuất thoát sau ~10 giây, YouTube ngừng đẩy.
 * Encode lại cho trùng thông số chương tĩnh để ghép copy. Lỗi/hết quota thì bỏ đoạn mở đầu, không làm hỏng tập.
 */
/** Thẻ tên truyện chiếm ngần này giây cuối intro. */
const TITLE_CARD_SECONDS = 5;

/** Track tiếng đập theo nhịp đổi ảnh của intro; lỗi (thiếu ffmpeg filter, v.v.) thì trả null, intro vẫn chạy. */
async function buildCutSfx(dir: string, scenes: { start: number; end: number }[], seconds: number): Promise<string | null> {
  // Cú nổ mở màn ở giây 0 đi cùng chữ hook — giật người xem ngay khung đầu; sau đó đập theo nhịp cắt.
  const events: SfxEvent[] = [{ kind: "boom", at: 0 }, ...sfxCutEvents(scenes, seconds)];
  const file = path.join(dir, "cold-sfx.wav");
  try {
    await ffmpeg(sfxTrackArgs(events, seconds, file));
    return file;
  } catch (e) {
    console.warn("⚠ Bỏ tiếng hiệu ứng intro:", e instanceof Error ? e.message.slice(0, 200) : e);
    return null;
  }
}

/**
 * Clip động cho MỌI cảnh của đoạn mở đầu (đoạn quyết định người xem ở lại): vẽ ảnh trước (cùng tên file buildVideo dùng → không vẽ lại),
 * đẩy Kaggle (LTX), chờ có hạn. Chỉ chạy trên Actions khi có key Kaggle; lỗi/quá hạn → Map rỗng, mở đầu dùng ảnh tĩnh như cũ.
 */
async function coldOpenClips(o: EpisodeInput, dir: string, scenes: { text: string }[], prompts: ScenePrompt[]): Promise<Map<number, string>> {
  if (!kaggleAuth() || process.env.I2V === "0" || !(process.env.GITHUB_ACTIONS || process.env.I2V === "1")) return new Map();
  try {
    const img = (i: number) => path.join(dir, `cold-img-${i}.jpg`);
    await pool(prompts, 3, (p, i) => drawImage(p.prompt, img(i), { width: 1280, height: 768, seed: 1000 + i * 7, refs: o.heroRef && p.hero ? [o.heroRef] : undefined }));
    const motions = await motionPrompts(prompts.map((p, i) => ({ prompt: p.prompt, text: scenes[i].text })));
    const work = path.join(dir, "i2v");
    await mkdir(work, { recursive: true });
    const jobs = await Promise.all(prompts.map(async (_, i) => {
      const file = path.join(work, `in-${i}.jpg`);
      await prepareClipImage(img(i), file, LOGO_CROP);
      return { id: i, image: `in-${i}.jpg`, prompt: motions[i], file };
    }));
    const out = await runI2v({ videoId: o.videoId, dir: work, jobs });
    console.log(`  Mở đầu: ${out.clips.size}/${jobs.length} clip động${out.reason ? ` (${out.reason})` : ""}`);
    return out.clips;
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw e;
    console.warn("⚠ Mở đầu không có clip động:", e instanceof Error ? e.message.slice(0, 200) : e);
    return new Map();
  }
}

async function makeColdOpen(o: EpisodeInput, m: z.infer<typeof episodeSchema>, music: string | null): Promise<{ file: string; seconds: number } | null> {
  if (!m.coldOpen?.trim()) return null;
  try {
    const dir = path.join(o.dir, "cold");
    await mkdir(dir, { recursive: true });
    // Sau cao trào là câu chuyển ngắn rồi vào thẳng chương đầu (không đọc tên truyện / tên chương máy móc).
    const first = o.chapters[0]?.chapter;
    const bridge = first ? ` Chuyện bắt đầu từ chương ${first.number}, ${first.title}.` : "";
    const narration = await narrate(`${m.coldOpen.trim()}${bridge}`, dir, o.s.ttsVoice);
    const scenes = splitScenes(narration.cues, coldOpenSceneCount(narration.seconds), narration.seconds);
    const prompts = await scenePrompts(m.characterLook, scenes.map((x) => x.text));
    const clips = await coldOpenClips(o, dir, scenes, prompts);
    // Tiếng đập đúng nhịp đổi ảnh. Lỗi thì bỏ, intro vẫn có giọng + nhạc như cũ.
    const sfx = await buildCutSfx(dir, scenes, narration.seconds);
    // Thẻ tên truyện + số tập hiện ở CUỐI intro rồi mở thẳng vào chương 1 (kiểu title card của phim).
    const card = `${o.s.title}\nTẬP ${o.episodeNo}`;
    const raw = await buildVideo({
      dir, name: "cold", narration, scenes, prompts, music, sfx,
      titleCard: card, titleCardStart: Math.max(0, narration.seconds - TITLE_CARD_SECONDS),
      hook: m.hookText?.trim() || undefined, clips, heroRef: o.heroRef,
      w: 1920, h: 1080, imgW: 1280, imgH: 768, fontSize: 62, marginV: 70,
    });
    const file = path.join(dir, "cold-open.mp4");
    await ffmpeg(conformArgs({ input: raw.out, out: file, w: 1920, h: 1080 }));
    const seconds = await duration(file);
    // YouTube bỏ cả mục lục nếu có mốc < 10 giây.
    if (seconds < 10) {
      console.warn(`⚠ Đoạn mở đầu chỉ ${seconds.toFixed(1)} giây — bỏ.`);
      return null;
    }
    console.log(`  Mở đầu cao trào: ${seconds.toFixed(1)} giây, ${scenes.length} ảnh`);
    return { file, seconds };
  } catch (e) {
    if (e instanceof QuotaExhaustedError) console.warn("⚠ Bỏ qua đoạn mở đầu (hết quota)");
    else console.warn("⚠ Bỏ qua đoạn mở đầu:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Màn kết 15 giây kêu gọi thích / chia sẻ / đăng ký, ghép vào CUỐI tập.
 * Nền lấy từ chính khung hình gần cuối video: không vẽ ảnh mới nên không tốn quota ảnh, và nhìn liền mạch với cảnh vừa xem.
 * Chừa sẵn cột phải cho thẻ End Screen thật (đặt tay trong Studio — YouTube không cho đặt qua API), xem OUTRO_CARD_SLOTS.
 * Lỗi gì cũng chỉ bỏ màn kết, không làm hỏng tập.
 */
export async function makeOutro(o: { dir: string; video: string; videoId: number; seconds: number }): Promise<{ file: string; seconds: number } | null> {
  try {
    const dir = path.join(o.dir, "outro");
    await mkdir(dir, { recursive: true });
    const bg = path.join(dir, "bg.jpg");
    // Khung hình 3 giây trước khi hết: cuối chương mờ ra đen nên lấy đúng khung cuối sẽ ra ảnh đen.
    await ffmpeg(["-ss", Math.max(0, o.seconds - 3).toFixed(2), "-i", o.video, "-frames:v", "1", "-q:v", "3", "-update", "1", bg]);
    const file = path.join(dir, "outro.mp4");
    await ffmpeg(
      outroArgs({
        img: bg, out: file, font: FONT, w: 1920, h: 1080, burnText: BURN_TEXT,
        music: await pickMusic(o.videoId),
        // PUBLISH_HOUR_UTC = 8 → 15h giờ Việt Nam; lấy từ hằng số để đổi lịch là chữ đổi theo.
        publishHour: `${PUBLISH_HOUR_UTC + 7}h`,
      }),
    );
    const seconds = await duration(file);
    console.log(`  Màn kết: ${seconds.toFixed(1)} giây`);
    return { file, seconds };
  } catch (e) {
    console.warn("⚠ Bỏ qua màn kết:", e instanceof Error ? e.message : e);
    return null;
  }
}

export type ShortInput = { dir: string; voice: string; script: string; characterLook: string; hook: string; music: string | null; heroRef?: string | null };

/** Dựng Short 15–20 giây từ lời đọc; ném lỗi (kể cả QuotaExhaustedError) để người gọi quyết định. Trả đường dẫn short.mp4. */
export async function renderShort(o: ShortInput): Promise<string> {
  const dir = path.join(o.dir, "short");
  await mkdir(dir, { recursive: true });
  const narration = await narrate(o.script, dir, o.voice, undefined, 34);
  // ~3,5 giây đổi 1 ảnh.
  const scenes = splitScenes(narration.cues, shortSceneCount(narration.seconds), narration.seconds);
  const raw = await scenePrompts(o.characterLook, scenes.map((x) => x.text));
  const video = await buildVideo({
    dir, name: "short", narration, scenes, music: o.music,
    prompts: raw.map((p) => ({ ...p, prompt: `${p.prompt}, vertical portrait composition` })),
    w: 1080, h: 1920, imgW: 768, imgH: 1408, fontSize: 80, marginV: 520, hook: o.hook, progressBar: true, heroRef: o.heroRef,
  });
  return video.out;
}

/** Short lúc dựng tập; lỗi/hết quota thì bỏ Short (tập vẫn lên, Short được bù sau bởi backfillEpisodeShorts). */
async function makeShort(o: EpisodeInput, m: z.infer<typeof episodeSchema>, music: string | null) {
  try {
    return await renderShort({ dir: o.dir, voice: o.s.ttsVoice, script: m.shortScript, characterLook: m.characterLook, hook: m.thumbnailText, music, heroRef: o.heroRef });
  } catch (e) {
    console.warn(`⚠ Bỏ qua Short${e instanceof QuotaExhaustedError ? " (hết quota)" : ""} — sẽ bù ở lượt daily sau:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export type ThumbVariant = { id: ThumbId; file: string };

/**
 * 3 phương án thumbnail: (a) cận mặt + chữ, (b) đối đầu quái vật/kẻ thù, (c) sức mạnh bùng nổ; nhãn "FULL 1H30" góc trên.
 * Lưu thumb-a/b/c.jpg; (a) còn được chép thành thumbnail.jpg (màn web + đăng lại dùng tên này).
 * (a) lỗi thì không có thumbnail (như trước); (b)/(c) lỗi chỉ bỏ phương án đó.
 */
async function makeThumbnails(o: EpisodeInput, m: z.infer<typeof episodeSchema>, total: number): Promise<ThumbVariant[]> {
  const prompts: Record<ThumbId, string> = { a: m.thumbnailPrompt, b: m.thumbnailPromptConfront, c: m.thumbnailPromptBurst };
  const badge = fullBadge(total);
  const out: ThumbVariant[] = [];
  for (const [i, id] of THUMB_IDS.entries()) {
    try {
      const file = await thumbnail(o.dir, `${prompts[id] || m.thumbnailPrompt}, ${THUMB_STYLE[id]}, ${m.characterLook}`, m.thumbnailText, badge, { name: thumbFile(id).replace(/\.jpg$/, ""), seed: 42 + i * 101 });
      out.push({ id, file });
    } catch (e) {
      console.warn(`⚠ Thumbnail ${id.toUpperCase()} lỗi:`, e instanceof Error ? e.message : e);
    }
  }
  const primary = out.find((t) => t.id === DEFAULT_THUMB) ?? out[0];
  if (primary) await copyFile(primary.file, path.join(o.dir, "thumbnail.jpg"));
  return out;
}

export async function buildEpisodeContent(o: EpisodeInput) {
  const durations = o.chapters.map((c) => c.seconds);
  const total = durations.reduce((a, b) => a + b, 0);
  const seo = await keywordResearch(genreSeeds(o.s.genre));
  const keywords = seo?.keywords.map((k) => k.keyword) ?? [];
  console.log(`  Từ khóa: ${seo?.keywords.slice(0, 6).map((k) => `${k.keyword} (${k.overall})`).join(", ") ?? "không có"}`);
  const m = await writeMeta(o, seo?.text ?? null, total);
  console.log(`  Meta bởi ${textProvider().lastModel}`);
  // Ngoại hình nam chính CỐ ĐỊNH cả bộ (hero.ts) thay cho mô tả AI viết riêng mỗi tập → mở đầu/Short/thumbnail cùng một mặt.
  const hero = await heroRef(o.s, o.dir);
  m.characterLook = hero.look;
  o.heroRef = hero.file;

  const options = [m.title, ...(m.titleAlternatives ?? [])].filter(Boolean);
  const scores = await scoreTitles(options);
  const ideas = await generateTitles(m.title, m.description);
  const all = [...options.map((t, i) => ({ title: t, score: scores?.[i] ?? null })), ...ideas.filter((x) => !options.includes(x.title))];
  for (const x of all) console.log(`  ${x.score ?? "?"} — ${x.title}`);
  const best = chooseTitle(all, keywords);
  const title = ensureEpisodeLabel(best.title, o);

  const music = await pickMusic(o.videoId);
  const draft: VideoMeta = {
    title, description: `${m.description}\n\n${AI_NOTE}`, tags: m.tags,
    shortTitle: m.shortTitle, shortDescription: m.shortDescription,
    shortScript: m.shortScript, thumbnailText: m.thumbnailText, characterLook: m.characterLook,
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
  console.log("● Mở đầu cao trào");
  const coldOpen = await makeColdOpen(o, m, music);
  const toc = buildEpisodeToc(items, coldOpen ? { seconds: coldOpen.seconds, title: "Mở đầu" } : undefined);
  const description = composeDescription(fixed.meta.description, toc, links, hashtagsFor(keywords), o.credits.join("\n\n"));
  const credit = music ? `\n\n${musicCredit(music)}` : "";
  const meta: VideoMeta = { ...fixed.meta, title, description, shortDescription: `${fixed.meta.shortDescription}${credit}`, compilation: o.compilation,
    shortScript: m.shortScript, thumbnailText: m.thumbnailText, characterLook: m.characterLook,
  };
  console.log(`  Điểm SEO: ${fixed.score}; tiêu đề: ${meta.title}`);

  console.log("● Thumbnail (3 phương án)");
  const thumbs = await makeThumbnails(o, m, total + (coldOpen?.seconds ?? 0));
  const thumb = (thumbs.find((t) => t.id === DEFAULT_THUMB) ?? thumbs[0])?.file ?? null;
  console.log("● Short");
  const short = await makeShort(o, m, music);
  return { meta, thumb, thumbs, short, coldOpen };
}
