import { createHash } from "node:crypto";
import { enrichDescription, segmentsFromCues } from "./description";
import { playlistUrl, seriesPlaylist } from "./playlist";
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type Chapter, type Series, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { drawImage, imagesReady } from "./images";
import { duration, escText, ffmpeg, ffmpegLog, filterPath, measureLufs, once, pool } from "./ffmpeg";
import { blastFilter, type BlastLayout } from "./thumb-blast";
import { Tracker } from "./progress";
import { buildClipSegment, newI2vRun, type I2vRun } from "./i2v";
import { newZImageRun, ZIMAGE_MODEL, type ZImageRun } from "./zimage";
import { sfxEvents, sfxImpactEvents, sfxTrackArgs } from "./sfx";
import { episodeMuxArgs, SFX_GAIN, STILL_FPS, stillFrames, stillSegmentArgs, voiceGainDb } from "./still";
import { cleanupParallax, prepareParallax } from "./parallax";
import { PARALLAX_BUDGET, parallaxFilterGraph, parallaxInputArgs, parallaxMotionFor, parallaxWorkDir, planParallax, type ParallaxFiles } from "./parallax-plan";
import { freshInsights, loadTrends, seoHints } from "@/lib/trends";
import { metaRequest, scenePrompts, scenesRequest, videoMeta } from "./prompts";
import { heroRef } from "./hero";
import { chapterNarration } from "./narration";
import { dropStaleTts, markTts } from "./tts-cache";
import { imageCount, isEpisodeOpener, planChapterScenes, planShots, shortSceneCount } from "./episode-plan";
import { isLifeStory, LIFE_IMAGE_SECONDS, LIFE_MAX_IMAGES, LIFE_NARRATOR_STYLE, LIFE_TEMPO, LIFE_TTS_VOICE_FEMALE, lifeVoice } from "@/lib/story/life";
import { OPENER_CLIPS, OPENER_SEGMENT_BUDGET } from "./i2v-plan";
import { ensureRelease, restoreImages, restoreTts, saveTts, uploadAsset } from "./release";
import { keepOrNextSlot } from "./schedule";
import { loadSecrets } from "@/lib/secrets";
import { chooseTitle, genreSeeds, keywordResearch, scoreTitles } from "./vidiq";
import { AI_NOTE, optimizeMeta } from "@/lib/seo-optimize";
import { autoPublishEligible, publishToYoutube } from "./youtube";

type ScenePrompt = Awaited<ReturnType<typeof scenePrompts>>[number];
import { cuesForChunk, cuesForSegment, packChunks, parseSilenceMids, sentences, snapToSentences, titleCardFilter, toAss, type Cue } from "./text";
import { speak, speakTurns, SpeechFormatError, type SpeechTurn } from "./tts";
import { IVOI_MAX_CHARS, IVOI_PREFIX, IVOI_VOICE_FEMALE, IVOI_VOICE_MALE, IVOI_VOICES, IvoiUnavailableError, ivoiReady, ivoiReusedCount, speakIvoi } from "./tts-ivoi";
import { castVoices, directScript, groupTurns, ivoiSegments, NARRATOR, stripTags } from "./voice-cast";

// Đường dẫn tương đối (ffmpeg chạy ở gốc repo): đường dẫn tuyệt đối trên Windows có "C:" làm vỡ cú pháp filter của drawtext.
const FONT_DIR = "pipeline/fonts";
export const FONT = `${FONT_DIR}/BeVietnamPro-Bold.ttf`;
/** Máy local thiếu libass/drawtext thì đặt BURN_TEXT=0 để test phần còn lại. */
export const BURN_TEXT = process.env.BURN_TEXT !== "0";
const FPS = 30;
/** Parallax 2.5D mặc định TẮT (bản zoompan 2× bị giật); bật bằng PARALLAX=1 khi đã có đường dựng sub-pixel mượt. */
const PARALLAX_ENABLED = process.env.PARALLAX === "1";

/** Mức chất lượng dựng của video chương thường và Short (chương nội bộ của chế độ tập dùng `buildStillVideo`, xem still.ts). */
export type Quality = { scale: number; sharpen: boolean; fps: number; vignette: boolean; crf: number; tag: string };
const NORMAL: Quality = { scale: 2, sharpen: true, fps: FPS, vignette: true, crf: 22, tag: "2" };

export type Narration = { audio: string; cues: Cue[]; seconds: number };

/** Kết quả AI được cache trong thư mục render: lần chạy lại (sau khi hết quota) không tốn lượt gọi lại. */
async function cached<T>(file: string, make: () => Promise<T>): Promise<T> {
  if (await access(file).then(() => true, () => false)) return JSON.parse(await readFile(file, "utf8"));
  const value = await make();
  await writeFile(file, JSON.stringify(value));
  return value;
}

const MAX_TTS_CHARS = 4000;
const ttsChunks = (text: string) => packChunks(sentences(text), MAX_TTS_CHARS);

/** Đọc toàn bộ văn bản thành 1 file WAV + cue phụ đề. File cache có tên giọng: đổi giọng thì đọc lại. */
/** Hệ số tốc độ đọc (1 = giữ nguyên giọng TTS). Đo chương 19: 195 âm tiết/phút → ×1,2 ≈ 234. */
export const NARRATION_TEMPO = Number(process.env.NARRATION_TEMPO ?? 1.2);

/** `tempo`: hệ số tốc độ (chuyện đời đọc tốc độ gốc = 1 — tăng tốc nghe vội, mất cảm xúc). */
export async function narrate(text: string, dir: string, voice: string, onChunk?: (i: number, total: number) => void, cueChars = 70, tempo = NARRATION_TEMPO): Promise<Narration> {
  const chunks = ttsChunks(text);
  const files = await pool(chunks, 3, async (chunk, i) => {
    const f = path.join(dir, `tts-${voice}-${String(i).padStart(3, "0")}.wav`);
    const fast = f.replace(/\.wav$/, `-x${tempo}.wav`);
    const said = chunk.join(" ");
    // Văn bản đoạn đổi so với lần đọc trước (cache) thì đọc lại — tránh audio cũ + phụ đề chữ mới (tts-cache.ts).
    await dropStaleTts(f, [fast], said);
    if (voice.startsWith(IVOI_PREFIX)) await speakIvoi(said, f, voice.slice(IVOI_PREFIX.length));
    else await speak(said, f, voice);
    await markTts(f, said);
    console.log(`  TTS ${i + 1}/${chunks.length}`);
    onChunk?.(i, chunks.length);
    // Kênh top cùng thể loại đọc 240–290 âm tiết/phút; giọng Gemini ~195 → tăng tốc giữ cao độ (atempo). Mốc câu đo trên bản đã tăng tốc.
    if (tempo === 1) return f;
    await once(fast, (tmp) => ffmpeg(["-i", f, "-af", `atempo=${tempo}`, "-c:a", "pcm_s16le", tmp]));
    return fast;
  });
  const cues: Cue[] = [];
  let t = 0;
  for (const [i, f] of files.entries()) {
    const d = await duration(f);
    // Khoảng lặng thật (ngắt câu của giọng đọc) để căn phụ đề + cắt cảnh; lỗi đo thì quay về ước theo ký tự.
    const pauses = parseSilenceMids(await ffmpegLog(["-i", f, "-af", "silencedetect=noise=-35dB:d=0.18", "-f", "null", "-"]).catch(() => ""));
    cues.push(...cuesForChunk(chunks[i], t, d, cueChars, pauses));
    t += d;
  }
  const list = path.join(dir, "tts.txt");
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
  const audio = path.join(dir, "narration.wav");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", audio]);
  return { audio, cues, seconds: t };
}

/**
 * Đọc kịch bản đã phân vai (voice-cast.ts): mỗi nhóm ≤ 2 giọng là một lượt gọi TTS, tốc độ gốc. File cache đặt tên theo
 * nội dung nhóm nên sửa truyện không dùng nhầm audio cũ. Kiểu gọi nhiều giọng bị từ chối → nhóm đó đọc một giọng người kể.
 */
export async function narrateScript(groups: SpeechTurn[][], dir: string, narratorVoice: string, onChunk?: (i: number, total: number) => void, cueChars = 70, tempo = 1): Promise<Narration> {
  const files = await pool(groups, 3, async (g, i) => {
    const key = createHash("sha1").update(JSON.stringify(g)).digest("hex").slice(0, 10);
    const f = path.join(dir, `tts-cast-${String(i).padStart(3, "0")}-${key}.wav`);
    try {
      if (g[0].voice.startsWith(IVOI_PREFIX)) {
        await speakIvoi(g.map((t) => t.text).join(" "), f, g[0].voice.slice(IVOI_PREFIX.length));
        // Nhấn nhá: đổi nhịp theo cảm xúc (giữ cao độ) + khoảng lặng thật sau đoạn. File gốc ivoi giữ nguyên (đã trả tiền).
        const speed = g[0].speed ?? 1;
        const pause = g.at(-1)!.pauseAfter ?? 0;
        if (speed !== 1 || pause > 0) {
          const paced = f.replace(/\.wav$/, `-p${speed}-${pause}.wav`);
          const af = [speed !== 1 ? `atempo=${speed}` : "", pause > 0 ? `apad=pad_dur=${pause}` : ""].filter(Boolean).join(",");
          await once(paced, (tmp) => ffmpeg(["-i", f, "-af", af, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", tmp]));
          console.log(`  TTS ${i + 1}/${groups.length} (${g[0].voice}, nhịp ×${speed}, lặng ${pause}s)`);
          onChunk?.(i, groups.length);
          return paced;
        }
      } else await speakTurns(g, f);
    } catch (e) {
      if (!(e instanceof SpeechFormatError)) throw e;
      // Đọc tách từng lượt (mỗi lượt 1 giọng, giữ cảm xúc) rồi nối — KHÔNG đọc gộp một giọng trơn (nghe "giọng máy").
      console.warn(`  ⚠ TTS nhiều giọng bị từ chối (${e.message.slice(0, 120)}) — đọc tách từng lượt`);
      const parts: string[] = [];
      for (const [j, t] of g.entries()) {
        const pf = f.replace(/\.wav$/, `-t${j}.wav`);
        await speakTurns([t], pf);
        parts.push(pf);
      }
      const plist = f.replace(/\.wav$/, "-parts.txt");
      await writeFile(plist, parts.map((x) => `file '${path.resolve(x)}'`).join("\n"));
      await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", plist, "-c", "copy", f]);
    }
    console.log(`  TTS ${i + 1}/${groups.length} (${[...new Set(g.map((t) => t.voice))].join(" + ")})`);
    onChunk?.(i, groups.length);
    if (tempo === 1) return f;
    const fast = f.replace(/\.wav$/, `-x${tempo}.wav`);
    await once(fast, (tmp) => ffmpeg(["-i", f, "-af", `atempo=${tempo}`, "-c:a", "pcm_s16le", tmp]));
    return fast;
  });
  const cues: Cue[] = [];
  let t = 0;
  for (const [i, f] of files.entries()) {
    const d = await duration(f);
    const pauses = parseSilenceMids(await ffmpegLog(["-i", f, "-af", "silencedetect=noise=-35dB:d=0.18", "-f", "null", "-"]).catch(() => ""));
    cues.push(...cuesForChunk(sentences(stripTags(groups[i].map((x) => x.text).join("\n"))), t, d, cueChars, pauses));
    t += d;
  }
  const list = path.join(dir, "tts.txt");
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
  const audio = path.join(dir, "narration.wav");
  await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", audio]);
  return { audio, cues, seconds: t };
}

/** Chia timeline thành `n` cảnh liền nhau theo cue, trả về [start, end, text]. */
export function splitScenes(cues: Cue[], n: number, total: number) {
  const span = total / n;
  const spans = snapToSentences(Array.from({ length: n }, (_, i) => ({ start: i * span, end: i === n - 1 ? total : (i + 1) * span })), cues);
  return spans.map(({ start, end }) => {
    return { start, end, text: cueTextBetween(cues, start, end) };
  });
}

/** Lời đọc (các cue chạm khoảng [start, end]) — prompt cảnh bám đúng câu đang đọc. */
export function cueTextBetween(cues: Cue[], start: number, end: number) {
  return cues.filter((c) => c.start < end && c.end > start).map((c) => c.text).join(" ");
}

const FADE = 0.8;
/** Pollinations không key có logo ở đáy ảnh → cắt 7%. Ảnh Cloudflare sạch, không cần. */
export const LOGO_CROP = process.env.CLOUDFLARE_API_TOKEN ? "" : "crop=iw:ih*0.93:0:0,";
const SHOT_SECONDS = 10;
/** Cảnh hành động chỉ cắt nhanh hơn (không rung, không chớp — người xem thấy khó chịu). */
const ACTION_SHOT_SECONDS = 5;
const MOTIONS = ["in", "left", "out", "right", "up", "in"] as const;
type Motion = (typeof MOTIONS)[number];

/**
 * Vẽ ảnh cảnh `i`. Một cảnh vẽ hỏng (Codex "I can't generate the image in this turn", lỗi mạng…) không được làm hỏng
 * cả video 90 phút (#89 ngày 19/11/2026): thử lại 1 lần seed khác (gói Plus, không tốn tiền), vẫn hỏng thì dùng tạm ảnh
 * cảnh gần nhất đã có. Hết lượt (QuotaExhaustedError) thì ném ra để video chờ lượt sau.
 */
async function drawSceneSafe(o: { i: number; total: number; prompt: string; imgOf: (j: number) => string; width: number; height: number; refs?: string[]; log?: (text: string) => void }) {
  const draw = (seed: number) => drawImage(o.prompt, o.imgOf(o.i), { width: o.width, height: o.height, seed, refs: o.refs });
  try {
    return await draw(1000 + o.i * 7);
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw e;
    console.warn(`  ⚠ Cảnh ${o.i} vẽ lỗi — thử lại: ${e instanceof Error ? e.message.slice(-200) : e}`);
  }
  try {
    return await draw(1000 + o.i * 7 + 1);
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw e;
    const order = [...Array(o.total).keys()].filter((j) => j !== o.i).sort((a, b) => Math.abs(a - o.i) - Math.abs(b - o.i));
    for (const j of order) {
      if (!(await access(o.imgOf(j)).then(() => true, () => false))) continue;
      await copyFile(o.imgOf(j), o.imgOf(o.i));
      console.warn(`  ⚠ Cảnh ${o.i} vẫn lỗi — dùng tạm ảnh cảnh ${j}`);
      o.log?.(`Cảnh ${o.i} vẽ lỗi — dùng tạm ảnh cảnh ${j}`);
      return undefined;
    }
    throw e;
  }
}

/** Biểu thức zoompan cho một kiểu máy quay; `e` là tiến độ có easing (chậm–nhanh–chậm). */
function motionExpr(m: Motion, frames: number) {
  const e = `(0.5-0.5*cos(PI*on/${frames}))`;
  const cx = "iw/2-(iw/zoom/2)";
  const cy = "ih/2-(ih/zoom/2)";
  switch (m) {
    case "in":
      return { z: `1+${ZOOM}*${e}`, x: cx, y: cy };
    case "out":
      return { z: `${1 + ZOOM}-${ZOOM}*${e}`, x: cx, y: cy };
    case "left":
      return { z: String(1 + ZOOM), x: `(iw-iw/zoom)*${e}`, y: cy };
    case "right":
      return { z: String(1 + ZOOM), x: `(iw-iw/zoom)*(1-${e})`, y: cy };
    case "up":
      return { z: String(1 + ZOOM), x: cx, y: `(ih-ih/zoom)*(1-${e})` };
  }
}

/** Zoom tối đa của chuyển động máy quay — thấp để không phóng ảnh nguồn (chỉ ~1MP) quá tay gây mờ. */
const ZOOM = 0.06;

/**
 * Ảnh → 1 cảnh có chuyển động máy quay. Phóng ảnh lên 2× khung ra (lanczos + làm nét) rồi mới zoompan:
 * zoompan làm tròn toạ độ theo pixel nguồn, nguồn 4K thì mỗi bước chỉ còn ½ pixel ở 1080p → hết rung.
 * Cắt 7% đáy để bỏ logo Pollinations.
 */
export async function shot(img: string, out: string, seconds: number, w: number, h: number, motion: Motion, q: Quality = NORMAL, parallax?: { files: ParallaxFiles; index: number }) {
  const frames = Math.max(1, Math.round(seconds * q.fps));
  const up = q.scale;
  // Parallax 2.5D (3 lớp theo độ sâu) thay cho zoompan; lỗi dựng đồ thị → rơi về zoompan bên dưới.
  if (parallax) {
    const graph = parallaxFilterGraph({
      w, h, frames, motionFrames: frames, fps: q.fps, motion: parallaxMotionFor(parallax.index), logoCrop: LOGO_CROP,
      canvasExtra: q.sharpen ? "unsharp=5:5:1.0" : undefined,
    });
    try {
      await ffmpeg([
        "-i", img, ...parallaxInputArgs(parallax.files), "-frames:v", String(frames),
        "-filter_complex", graph, "-map", "[v]",
        "-c:v", "libx264", "-preset", "superfast", "-crf", "18", "-r", String(q.fps), out,
      ]);
      return;
    } catch (e) {
      console.warn("⚠ Parallax lỗi, dùng zoompan:", e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  const { z, x, y } = motionExpr(motion, frames);
  await ffmpeg([
    "-loop", "1", "-i", img, "-t", seconds.toFixed(3),
    "-vf",
    `${LOGO_CROP}scale=${w * up}:${h * up}:force_original_aspect_ratio=increase:flags=${q.sharpen ? "lanczos" : "bicubic"},crop=${w * up}:${h * up}:(iw-ow)/2:(ih-oh)*0.3,${q.sharpen ? "unsharp=5:5:1.0," : ""}` +
      `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${q.fps},format=yuv420p`,
    // File tạm (còn mã hoá lại ở bước cuối) → nén nhanh hơn, crf thấp hơn để không mất chất lượng; đỡ phút GitHub Actions.
    "-c:v", "libx264", "-preset", "superfast", "-crf", "18", "-r", String(q.fps), out,
  ]);
}

/**
 * File ASS phụ đề của MỘT đoạn (kênh top đốt phụ đề suốt video: 1 vế câu, giữa đáy khung). Mốc theo khung đã làm tròn của đoạn.
 * Không đốt chữ được (BURN_TEXT=0) hoặc đoạn không có câu nào → undefined.
 */
async function segmentSubs(dir: string, key: string, cues: Cue[], start: number, end: number, w: number, h: number) {
  if (!BURN_TEXT || !SEGMENT_SUBS) return undefined;
  const s0 = Math.round(start * STILL_FPS) / STILL_FPS;
  const s1 = Math.round(end * STILL_FPS) / STILL_FPS;
  const part = cuesForSegment(cues, s0, s1);
  if (!part.length) return undefined;
  const file = path.join(dir, `${key}-subs.ass`);
  await writeFile(file, toAss(part, { width: w, height: h, fontSize: 58, marginV: 60, karaoke: true }));
  return file;
}

/** Góc máy ảo nhiều shot/ảnh trong chương nội bộ (SHOT_CUTS=0 để tắt). */
const SHOT_CUTS = process.env.SHOT_CUTS !== "0";

/** Đốt phụ đề vào chương nội bộ (SEGMENT_SUBS=0 để tắt). */
const SEGMENT_SUBS = process.env.SEGMENT_SUBS !== "0";

/** Chương `number` có mở đầu tập kế tiếp không — theo chương cuối của tập đã ghép gần nhất (bỏ tập lỗi). */
async function episodeOpener(seriesId: number, number: number, k: number) {
  // Import động: compile.ts import render.ts → tránh vòng import lúc nạp module.
  const { seriesRows } = await import("./compile");
  const tos = (await seriesRows(seriesId)).filter((r) => r.meta?.compilation?.episode && r.status !== "failed").map((r) => r.meta!.compilation!.to);
  return isEpisodeOpener(number, tos.length ? Math.max(...tos) : 0, k);
}

/** Shot từ clip động: phóng lanczos lên khung, đủ `seconds` (thiếu thì giữ khung cuối), cùng thông số mã hoá với `shot`. */
export async function clipShot(clip: string, out: string, seconds: number, w: number, h: number, q: Quality = NORMAL) {
  await ffmpeg([
    "-i", clip, "-t", seconds.toFixed(3),
    "-vf", `fps=${q.fps},scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},${q.sharpen ? "unsharp=5:5:0.8," : ""}tpad=stop_mode=clone:stop_duration=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "superfast", "-crf", "18", "-r", String(q.fps), out,
  ]);
}

/** Nối các cảnh bằng crossfade theo nhóm (nhóm lớn quá ffmpeg tốn RAM); giữa các nhóm là cắt thẳng. */
export async function crossfadeGroup(clips: { file: string; seconds: number; fade: number; fx: string }[], out: string) {
  if (clips.length === 1) return ffmpeg(["-i", clips[0].file, "-c", "copy", out]);
  const inputs = clips.flatMap((c) => ["-i", c.file]);
  let graph = "";
  let offset = 0;
  let prev = "[0]";
  clips.slice(0, -1).forEach((c, i) => {
    const next = clips[i + 1];
    offset += c.seconds - next.fade;
    const label = i === clips.length - 2 ? "[v]" : `[x${i}]`;
    graph += `${prev}[${i + 1}]xfade=transition=${next.fx}:duration=${next.fade}:offset=${offset.toFixed(3)}${label};`;
    prev = label;
  });
  await ffmpeg([...inputs, "-filter_complex", graph.slice(0, -1), "-map", "[v]", "-c:v", "libx264", "-preset", "superfast", "-crf", "18", out]);
}

export async function buildVideo(opts: {
  dir: string; name: string; narration: Narration; music?: string | null; prompts: ScenePrompt[]; scenes: { start: number; end: number }[];
  w: number; h: number; imgW: number; imgH: number; fontSize: number; marginV: number; titleCard?: string;
  /** Giây bắt đầu hiện thẻ tên truyện (mặc định 0 = đầu video; intro đặt ở cuối để mở vào chương 1). */
  titleCardStart?: number;
  /** Track tiếng hiệu ứng dài bằng video (sfx.ts) — intro dùng để đập theo nhịp cắt. */
  sfx?: string | null;
  /** Short: chữ lớn 2 giây đầu để giữ người lướt; thanh tiến độ mảnh trên đỉnh. */
  hook?: string; progressBar?: boolean;
  /** Clip động theo chỉ số ảnh (đoạn mở đầu): shot của ảnh có clip dùng clip thay ảnh tĩnh + máy quay. */
  clips?: Map<number, string>;
  /** Ảnh mẫu nam chính (hero.ts): cảnh có `hero` vẽ kèm làm tham chiếu. */
  heroRef?: string | null;
  /** Mặc định NORMAL. */
  quality?: Quality;
  /** Không nhạc nền, chỉ giọng (+ hiệu ứng nếu có). */
  noMusic?: boolean;
  /** Âm lượng nhạc (mặc định 0,28). `duck`: nhạc tự hạ khi có giọng đọc, lên lại ở khoảng lặng (kể chuyện cảm xúc). */
  musicGain?: number;
  duck?: boolean;
  /** Báo tiến độ cho màn flow: ảnh vẽ xong (lần đầu), tổng số shot, từng shot xong, việc ghép. */
  on?: { image?: (i: number, file: string, model?: string) => Promise<void>; shots?: (n: number) => void; shot?: () => void; log?: (text: string) => void };
}) {
  const { dir, name, narration, prompts, scenes, w, h, on } = opts;
  const q = opts.quality ?? NORMAL;
  // Mỗi ảnh (1 scene) tách thành nhiều cảnh ~10s với kiểu máy quay khác nhau.
  const shots = scenes.flatMap((sc, i) => {
    const action = prompts[i].action;
    const n = Math.max(1, Math.round((sc.end - sc.start) / (action ? ACTION_SHOT_SECONDS : SHOT_SECONDS)));
    const len = (sc.end - sc.start) / n;
    return Array.from({ length: n }, (_, k) => ({
      image: i, k, seconds: len, action,
      motion: MOTIONS[(i * 2 + k) % MOTIONS.length],
      fade: FADE,
      fx: "fade",
    }));
  });
  on?.shots?.(shots.length);
  const GROUP = 12;
  // Mỗi ảnh chỉ vẽ một lần dù nhiều shot dùng chung (các shot chạy song song).
  const drawn = new Map<number, Promise<void>>();
  const draw = (i: number, img: string) => {
    if (!drawn.has(i)) {
      drawn.set(i, (async () => {
        const refs = opts.heroRef && prompts[i].hero ? [opts.heroRef] : undefined;
        const imgOf = (j: number) => path.join(dir, `${name}-img-${j}.jpg`);
        const model = await drawSceneSafe({ i, total: prompts.length, prompt: prompts[i].prompt, imgOf, width: opts.imgW, height: opts.imgH, refs, log: on?.log });
        await on?.image?.(i, img, model);
      })());
    }
    return drawn.get(i)!;
  };
  // Dọn file dựng kiểu cũ (trước khi có shot2/group2/silent2) để cache .render không phình.
  const old = new RegExp(`^${name}-(shot-\\d+|group-\\d+|silent)\\.mp4$`);
  for (const f of await readdir(dir).catch(() => [] as string[])) if (old.test(f)) await rm(path.join(dir, f), { force: true });
  // Parallax: mỗi ảnh chuẩn bị mặt nạ 1 lần dù nhiều shot dùng chung; null (lỗi/tắt) → shot dùng zoompan.
  const prepared = new Map<number, Promise<ParallaxFiles | null>>();
  const parallaxFor = (i: number, img: string) => {
    if (!PARALLAX_ENABLED) return Promise.resolve(null);
    if (!prepared.has(i)) prepared.set(i, prepareParallax({ img, workDir: parallaxWorkDir(img), w, h, logoCrop: LOGO_CROP }));
    return prepared.get(i)!;
  };
  const files = await pool(shots, 4, async (sh, j) => {
    const img = path.join(dir, `${name}-img-${sh.image}.jpg`);
    await draw(sh.image, img);
    const px = await parallaxFor(sh.image, img);
    // Cảnh nào sẽ crossfade với cảnh sau thì kéo dài thêm FADE để tổng thời lượng vẫn khớp giọng đọc.
    const fadesNext = j % GROUP !== GROUP - 1 && j !== shots.length - 1;
    const seconds = sh.seconds + (fadesNext ? shots[j + 1].fade : 0);
    // "shot2": đổi tên khi đổi cách mã hoá để không trộn file cũ; once() → job bị huỷ chạy lại thì bỏ qua cảnh đã dựng.
    const file = path.join(dir, `${name}-shot${q.tag}-${String(j).padStart(3, "0")}.mp4`);
    const clip = opts.clips?.get(sh.image);
    await once(file, (tmp) => (clip ? clipShot(clip, tmp, seconds, w, h, q) : shot(img, tmp, seconds, w, h, sh.motion, q, px ? { files: px, index: sh.image + sh.k } : undefined)));
    if (j % 10 === 0) console.log(`  ${name} cảnh ${j + 1}/${shots.length}`);
    on?.shot?.();
    return { file, seconds, fade: sh.fade, fx: sh.fx };
  });
  await Promise.all([...new Set(shots.map((sh) => sh.image))].map((i) => cleanupParallax(parallaxWorkDir(path.join(dir, `${name}-img-${i}.jpg`)))));
  on?.log?.("Ghép các cảnh (crossfade)");

  const groups: string[] = [];
  for (let g = 0; g * GROUP < files.length; g++) {
    const out = path.join(dir, `${name}-group${q.tag}-${g}.mp4`);
    await once(out, (tmp) => crossfadeGroup(files.slice(g * GROUP, (g + 1) * GROUP), tmp));
    groups.push(out);
  }
  const list = path.join(dir, `${name}-groups.txt`);
  await writeFile(list, groups.map((c) => `file '${c}'`).join("\n"));
  const silent = path.join(dir, `${name}-silent${q.tag}.mp4`);
  await once(silent, (tmp) => ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", tmp]));

  const out = path.join(dir, `${name}.mp4`);
  // Bản cuối đã xuất đủ dài (job trước bị huỷ ở bước sau, vd lúc làm Short) thì dùng lại, khỏi trộn ~30 phút nữa.
  if (await duration(out).then((d) => d >= narration.seconds - 1.5, () => false)) {
    on?.log?.("Dùng lại video đã xuất ở lần chạy trước");
    return { out };
  }
  await rm(out, { force: true });
  const ass = path.join(dir, `${name}.ass`);
  await writeFile(ass, toAss(narration.cues, { width: w, height: h, fontSize: opts.fontSize, marginV: opts.marginV, karaoke: true }));
  // Màu điện ảnh: tăng tương phản nhẹ, tối 4 góc, hạt phim.
  const grade = q.vignette ? "eq=contrast=1.05:saturation=1.08,vignette=PI/6" : "eq=contrast=1.05:saturation=1.08";
  const text = BURN_TEXT
    ? `,ass=${filterPath(ass)}:fontsdir=${filterPath(FONT_DIR)}` +
      (opts.titleCard ? titleCardFilter({ text: opts.titleCard, w, font: FONT, start: opts.titleCardStart ?? 0 }) : "") +
      (opts.hook ? hookText(opts.hook, w) : "")
    : "";
  // Thanh tiến độ vàng mảnh trên đỉnh Short: người xem thấy còn bao lâu nên ít lướt qua.
  const bar = opts.progressBar ? `,drawbox=x=0:y=0:w='iw*t/${narration.seconds.toFixed(2)}':h=12:color=0xFFD23F@0.95:t=fill` : "";
  on?.log?.(`Trộn giọng đọc${opts.noMusic ? "" : ", nhạc nền"}${opts.sfx ? ", tiếng hiệu ứng" : ""}, phụ đề`);
  // Tiếng hiệu ứng (intro): input thứ 4, trộn thẳng ở SFX_GAIN như bên chương tĩnh.
  const audio = opts.noMusic ? [
    ...(opts.sfx ? ["-i", opts.sfx, "-filter_complex", `[2:a]volume=${SFX_GAIN}[sx];[1:a][sx]amix=inputs=2:duration=first:normalize=0[a]`] : []),
    "-map", "0:v", "-map", opts.sfx ? "[a]" : "1:a",
  ] : await musicArgs();
  async function musicArgs() {
    const music = opts.music ?? (await ambientBed(dir));
    const gain = opts.musicGain ?? (music.endsWith("ambient.wav") ? 0.4 : 0.28);
    // Ducking: giọng làm tín hiệu điều khiển nén nhạc (sidechain) — nhạc lùi xuống khi kể, dâng lên ở chỗ ngừng.
    const voice = opts.duck ? "[1:a]asplit=2[v][vs];" : "";
    const bed = opts.duck
      ? `[2:a]volume=${gain}[m0];[m0][vs]sidechaincompress=threshold=0.02:ratio=4:attack=80:release=900[m];`
      : `[2:a]volume=${gain}[m];`;
    const v = opts.duck ? "[v]" : "[1:a]";
    return [
    "-stream_loop", "-1", "-i", music,
    ...(opts.sfx ? ["-i", opts.sfx] : []),
    "-filter_complex",
    voice + bed +
      (opts.sfx
        ? `[3:a]volume=${SFX_GAIN}[sx];${v}[m][sx]amix=inputs=3:duration=first:normalize=0[a]`
        : `${v}[m]amix=inputs=2:duration=first:normalize=0[a]`),
    "-map", "0:v", "-map", "[a]",
    ];
  }
  await once(out, (tmp) =>
    ffmpeg([
      "-i", silent, "-i", narration.audio, ...audio,
      "-vf", `${grade}${text}${bar},format=yuv420p`,
      // Hạt phim làm bitrate phình (12 phút ≈ 256MB) → chặn ~5Mbps, đủ nét cho YouTube 1080p.
      "-c:v", "libx264", "-preset", "veryfast", "-crf", String(q.crf), "-maxrate", "5M", "-bufsize", "10M",
      "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", tmp,
    ]),
  );
  return { out };
}

/**
 * Video chương nội bộ của chế độ tập: mỗi ảnh 1 đoạn tĩnh (mờ vào/ra), nối concat copy, trộn âm thanh ở bước cuối với video copy.
 * Không phụ đề, không title card, không zoompan/xfade/grade. Giữ nguyên 1080p.
 */
export async function buildStillVideo(opts: {
  dir: string; name: string; narration: Narration; music?: string | null; prompts: ScenePrompt[]; scenes: { start: number; end: number; zoom?: boolean }[];
  w: number; h: number; imgW: number; imgH: number;
  /** Clip động (Kaggle): cảnh được chọn dùng clip thay ảnh tĩnh; lỗi/quá hạn thì giữ ảnh tĩnh. */
  i2v?: I2vRun;
  /** AI vẽ phụ (Z-Image trên Kaggle): cảnh được giao dựng SAU, khi ảnh về; thiếu ảnh thì GPT vẽ bù. */
  zimage?: ZImageRun;
  /** Ảnh mẫu nam chính: cảnh có `hero` vẽ kèm làm tham chiếu (giữ mặt/tóc/trang phục). */
  heroRef?: string | null;
  on?: {
    image?: (i: number, file: string, model?: string) => Promise<void>; shots?: (n: number) => void; shot?: () => void; log?: (text: string) => void;
    /** Clip động đã tải về (hoặc lỗi → `failure`): cho phép upload clip lên kho và đóng bước. */
    clips?: (clips: Map<number, string>, failure: string | null) => Promise<void>;
  };
}) {
  const { dir, name, narration, prompts, scenes, w, h, on, i2v, zimage } = opts;
  on?.shots?.(scenes.length);
  const out = path.join(dir, `${name}.mp4`);
  // Bản cuối đã xuất đủ dài (job trước bị huỷ ở bước sau) thì dùng lại.
  if (await duration(out).then((d) => d >= narration.seconds - 1.5, () => false)) {
    on?.log?.("Dùng lại video đã xuất ở lần chạy trước");
    return { out };
  }
  await rm(out, { force: true });
  const imgOf = (i: number) => path.join(dir, `${name}-img-${i}.jpg`);
  // Mỗi ảnh vẽ + báo một lần (cảnh chọn làm clip được vẽ trước để đẩy Kaggle sớm, vòng chính không vẽ lại).
  const drawn = new Map<number, Promise<void>>();
  const drawScene = (i: number) => {
    if (!drawn.has(i)) {
      drawn.set(i, (async () => {
        const refs = opts.heroRef && prompts[i].hero ? [opts.heroRef] : undefined;
        const model = await drawSceneSafe({ i, total: prompts.length, prompt: prompts[i].prompt, imgOf, width: opts.imgW, height: opts.imgH, refs, log: on?.log });
        await on?.image?.(i, imgOf(i), model);
      })());
    }
    return drawn.get(i)!;
  };
  // Cảnh giao Kaggle vẽ (trừ cảnh đã có ảnh từ lần chạy trước): vòng chính bỏ qua, dựng sau khi ảnh về.
  const deferred = new Set<number>();
  if (zimage) {
    for (const i of zimage.picks) if (!(await access(imgOf(i)).then(() => true, () => false))) deferred.add(i);
    if (deferred.size) zimage.begin();
  }
  if (i2v) {
    await pool(i2v.picks, 3, drawScene);
    i2v.begin(imgOf);
  }
  // Ảnh nào áp parallax và bao nhiêu giây: 2 phút đầu đủ đoạn; phần sau theo ngân sách (cảnh action trước, rồi vài giây đầu mỗi ảnh).
  const parallaxPlan = PARALLAX_ENABLED ? planParallax(scenes.map((sc, i) => ({ ...sc, action: prompts[i].action })), PARALLAX_BUDGET) : scenes.map(() => ({ seconds: 0 }));
  const sentenceEnds = narration.cues.filter((c) => /[.!?…]["”'»)]*$/.test(c.text.trim())).map((c) => c.end);
  const buildSegment = async (sc: (typeof scenes)[number], i: number) => {
    const img = imgOf(i);
    await drawScene(i);
    const file = path.join(dir, `${name}-seg-${String(i).padStart(3, "0")}.mp4`);
    const frames = stillFrames(sc.start, sc.end);
    // Cảnh đánh nhau: chớp trắng + đẩy ống kính + rung tắt dần (still.ts). Ảnh vẫn tĩnh nhưng máy quay có nhịp.
    const subs = await segmentSubs(dir, `${name}-${i}`, narration.cues, sc.start, sc.end, w, h);
    const segment = { img, frames, w, h, logoCrop: LOGO_CROP, zoom: sc.zoom, action: prompts[i].action, subs };
    // Góc máy ảo: cảnh dài cắt thành nhiều shot ~4s (đổi khung, cắt đúng lúc hết câu), shot nào cũng đẩy máy chậm (ảnh không đứng im),
    // rồi nối copy thành 1 file đoạn.
    const shots = SHOT_CUTS && parallaxPlan[i].seconds <= 0 ? planShots(sc.start, sc.end, sentenceEnds) : [];
    if (shots.length > 1) {
      await once(file, async (tmp) => {
        const parts: string[] = [];
        for (const [k, sh] of shots.entries()) {
          const part = path.join(dir, `${name}-seg-${String(i).padStart(3, "0")}-${k}.mp4`);
          const shotSubs = await segmentSubs(dir, `${name}-${i}-${k}`, narration.cues, sh.start, sh.end, w, h);
          await once(part, (t) =>
            ffmpeg(stillSegmentArgs({ ...segment, frames: stillFrames(sh.start, sh.end), action: k === 0 && segment.action, zoom: true, subs: shotSubs, framing: sh.framing, out: t })),
          );
          parts.push(part);
        }
        const list = path.join(dir, `${name}-seg-${String(i).padStart(3, "0")}-parts.txt`);
        await writeFile(list, parts.map((p) => `file '${p}'`).join("\n"));
        await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", tmp]);
        for (const p of parts) await rm(p, { force: true });
      });
      on?.shot?.();
      return file;
    }
    await once(file, async (tmp) => {
      const workDir = parallaxWorkDir(img);
      const files = parallaxPlan[i].seconds > 0 ? await prepareParallax({ img, workDir, w, h, logoCrop: LOGO_CROP }) : null;
      try {
        if (files) {
          const parallax = { files, motion: parallaxMotionFor(i), motionFrames: Math.round(parallaxPlan[i].seconds * STILL_FPS) };
          // Lỗi ffmpeg ở đồ thị parallax cũng không làm hỏng render: dựng lại bằng zoompan/tĩnh như cũ.
          await ffmpeg(stillSegmentArgs({ ...segment, out: tmp, parallax })).catch((e) => {
            console.warn(`⚠ Parallax ảnh ${i} lỗi, dùng dựng cũ:`, e instanceof Error ? e.message.slice(0, 200) : e);
            return ffmpeg(stillSegmentArgs({ ...segment, out: tmp }));
          });
        } else await ffmpeg(stillSegmentArgs({ ...segment, out: tmp }));
      } finally {
        if (files) await cleanupParallax(workDir);
      }
    });
    on?.shot?.();
    return file;
  };
  const files = await pool(scenes, 3, (sc, i) => (deferred.has(i) ? Promise.resolve("") : buildSegment(sc, i)));
  if (zimage && deferred.size) {
    on?.log?.("Chờ ảnh vẽ phụ từ Kaggle (Z-Image)");
    const { images, failure } = await zimage.collect();
    if (failure) on?.log?.(`Z-Image: ${failure} — GPT vẽ bù phần thiếu`);
    for (const [i, file] of images) {
      if (!deferred.has(i)) continue;
      await copyFile(file, imgOf(i));
      // Đánh dấu đã vẽ để buildSegment không gọi GPT; báo ảnh cho màn flow như ảnh thường.
      drawn.set(i, on?.image?.(i, imgOf(i), ZIMAGE_MODEL) ?? Promise.resolve());
    }
    await pool([...deferred], 3, async (i) => {
      files[i] = await buildSegment(scenes[i], i);
    });
  }
  let sfx: string | null = null;
  if (i2v) {
    // Kaggle chạy song song với dựng các đoạn tĩnh ở trên; giờ chờ nốt (có hạn) rồi thay đoạn của cảnh có clip.
    on?.log?.("Chờ clip động từ Kaggle");
    const { clips, failure } = await i2v.collect();
    await pool([...clips.entries()], 2, async ([scene, clip]) => {
      const seg = path.join(dir, `${name}-seg-clip-${String(scene).padStart(3, "0")}.mp4`);
      const sc = scenes[scene];
      const subs = await segmentSubs(dir, `${name}-clip-${scene}`, narration.cues, sc.start, sc.end, w, h);
      await buildClipSegment({ clip, img: imgOf(scene), file: seg, start: sc.start, end: sc.end, w, h, logoCrop: LOGO_CROP, subs });
      files[scene] = seg;
    });
    await on?.clips?.(clips, failure);
  }
  // Tiếng hiệu ứng: cú "ầm" vào đúng lúc mở cảnh đánh nhau (khớp chớp trắng + rung khung) + hiệu ứng của clip động.
  // Chạy cả khi KHÔNG có clip động — cảnh hành động lúc nào cũng có. Lỗi thì bỏ, tập vẫn có giọng + nhạc như cũ.
  const events = [
    ...sfxImpactEvents(scenes.map((sc, i) => ({ ...sc, action: prompts[i].action })), narration.seconds),
    ...(i2v ? sfxEvents(i2v.clips, scenes, narration.seconds) : []),
  ].sort((a, b) => a.at - b.at);
  if (events.length) {
    const file = path.join(dir, `${name}-sfx.wav`);
    try {
      await once(file, (tmp) => ffmpeg(sfxTrackArgs(events, narration.seconds, tmp)));
      sfx = file;
      on?.log?.(`Tiếng hiệu ứng: ${events.length} tiếng`);
    } catch (e) {
      on?.log?.(`⚠ Không dựng được tiếng hiệu ứng: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
    }
  }
  on?.log?.(`Nối đoạn + trộn giọng, nhạc nền${sfx ? ", tiếng hiệu ứng" : ""} (video copy)`);
  const list = path.join(dir, `${name}-segments.txt`);
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
  const music = opts.music ?? (await ambientBed(dir));
  const voiceGain = voiceGainDb(await measureLufs(narration.audio));
  await once(out, (tmp) =>
    ffmpeg(episodeMuxArgs({ list, narration: narration.audio, music, seconds: narration.seconds, isAmbient: music.endsWith("ambient.wav"), voiceGain, sfx, out: tmp })),
  );
  return { out };
}

/** Chữ hook 2 giây đầu Short: xuống 2 dòng khi dài, cỡ chữ co theo dòng dài nhất để không tràn mép. */
function hookText(hook: string, w: number) {
  const words = hook.toUpperCase().split(/\s+/).filter(Boolean);
  let lines = [words.join(" ")];
  if (lines[0].length > 11 && words.length > 1) {
    // Chia 2 dòng cân nhau theo số ký tự.
    let best = 1;
    for (let i = 1; i < words.length; i++) {
      const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
      if (diff < Math.abs(words.slice(0, best).join(" ").length - words.slice(best).join(" ").length)) best = i;
    }
    lines = [words.slice(0, best).join(" "), words.slice(best).join(" ")];
  }
  const longest = Math.max(...lines.map((l) => l.length));
  const size = Math.round(Math.min(w / 8.5, (w * 0.86) / (longest * 0.66)));
  // Mỗi dòng một drawtext để canh giữa từng dòng (text_align không có trên FFmpeg cũ của máy render).
  const lineH = Math.round(size * 1.15);
  const top = `h*0.3-${Math.round((lineH * lines.length) / 2)}`;
  return lines
    .map(
      (line, i) =>
        `,drawtext=fontfile=${filterPath(FONT)}:text='${escText(line)}':fontsize=${size}:fontcolor=#FFD23F:borderw=${Math.round(size / 11)}:bordercolor=black:x=(w-tw)/2:y=${top}+${i * lineH}:alpha='if(lt(t,0.25),t/0.25,if(lt(t,1.9),1,max(0,(2.3-t)/0.4)))':enable='lt(t,2.3)'`,
    )
    .join("");
}

/**
 * Nhạc nền trong pipeline/music/ (Kevin MacLeod, incompetech.com — CC BY 4.0: được kiếm tiền, phải ghi công).
 * Chọn theo id video để chạy lại vẫn đúng bài đã ghi công trong mô tả.
 */
export async function pickMusic(seed: number) {
  const dir = path.resolve("pipeline/music");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".mp3")).sort();
  return files.length ? path.join(dir, files[seed % files.length]) : null;
}

/** Nhạc cảm xúc kênh chuyện đời (piano/strings buồn, Kevin MacLeod CC BY 4.0) — chủ kênh muốn có nhạc từ 20/11/2026. */
export async function lifeMusicTracks() {
  const dir = path.resolve("pipeline/music/life");
  return (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".mp3")).sort().map((f) => path.join(dir, f));
}

/** Ghi công gộp cho mọi bài trong nền nhạc chuyện đời (CC BY bắt buộc ghi công từng bài). */
export function lifeMusicCredit(tracks: string[]) {
  if (!tracks.length) return "";
  const titles = tracks.map((t) => `"${path.basename(t, ".mp3")}"`).join(", ");
  return `Nhạc nền: ${titles} – Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`;
}

/** Xáo thứ tự theo seed (cùng video → cùng thứ tự; video khác → mở bằng bài khác). */
export function seededOrder<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Nền nhạc dài đủ `seconds`: nối các bài theo thứ tự xáo, mỗi bài fade vào/ra 4 giây (hết danh sách thì lặp lại).
 * Một bài lặp suốt 90 phút nghe đơn điệu — 11 bài (~46 phút) mỗi bài nghe tối đa 2 lần.
 */
export async function lifeMusicBed(dir: string, seconds: number, seed: number) {
  const tracks = seededOrder(await lifeMusicTracks(), seed);
  if (!tracks.length) return null;
  const out = path.join(dir, "life-music.m4a");
  if (await duration(out).then((d) => d >= seconds - 1, () => false)) return out;
  const list: { file: string; len: number }[] = [];
  let total = 0;
  for (let k = 0; total < seconds + 5; k++) {
    const file = tracks[k % tracks.length];
    const len = await duration(file);
    list.push({ file, len });
    total += len;
  }
  const FADE_S = 4;
  const inputs = list.flatMap((t) => ["-i", t.file]);
  const chains = list.map((t, i) => `[${i}:a]afade=t=in:d=${FADE_S},afade=t=out:st=${Math.max(0, t.len - FADE_S).toFixed(2)}:d=${FADE_S},aformat=sample_rates=44100:channel_layouts=mono[t${i}]`);
  const concat = `${list.map((_, i) => `[t${i}]`).join("")}concat=n=${list.length}:v=0:a=1,atrim=0:${seconds.toFixed(2)}[out]`;
  await once(out, (tmp) => ffmpeg([...inputs, "-filter_complex", `${chains.join(";")};${concat}`, "-map", "[out]", "-c:a", "aac", "-b:a", "96k", tmp]));
  return out;
}

/**
 * Dòng ghi công trong mô tả. File `<tên bài>.txt` cạnh bài nhạc thì dùng nội dung đó (rỗng = nhạc không cần ghi công,
 * vd YouTube Audio Library loại không yêu cầu); không có thì là bài Kevin MacLeod — ghi công bắt buộc của CC BY 4.0.
 */
export function musicCredit(file: string) {
  const sidecar = file.replace(/\.mp3$/, ".txt");
  if (existsSync(sidecar)) return readFileSync(sidecar, "utf8").trim();
  const title = path.basename(file, ".mp3");
  return `Nhạc nền: "${title}" – Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`;
}

/**
 * Nền âm thanh "ma đạo" tự sinh khi chưa có nhạc: tiếng trầm 55/82Hz lên xuống chậm + gió (brown noise lọc thấp) + vang.
 * Sinh bằng FFmpeg nên không dính bản quyền; dài 3 phút, lặp khi video dài hơn.
 */
async function ambientBed(dir: string) {
  const out = path.join(dir, "ambient.wav");
  if (await access(out).then(() => true, () => false)) return out;
  const drone =
    "aevalsrc='0.22*sin(2*PI*55*t)*(0.65+0.35*sin(2*PI*0.045*t))+0.14*sin(2*PI*82.41*t)*(0.6+0.4*sin(2*PI*0.031*t+1.3))+0.06*sin(2*PI*110*t)*(0.5+0.5*sin(2*PI*0.07*t+2))':s=44100:d=180";
  await ffmpeg([
    "-f", "lavfi", "-i", drone,
    "-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.35:d=180:r=44100",
    "-filter_complex",
    "[1:a]lowpass=f=320,volume=0.55[w];[0:a][w]amix=inputs=2:normalize=0,aecho=0.8:0.6:160|320:0.35|0.2,afade=t=in:d=4,afade=t=out:st=176:d=4,aformat=channel_layouts=stereo",
    out,
  ]);
  return out;
}

/**
 * Thumbnail kiểu "chữ nổ" (thumb-blast.ts): mặt nhân vật nửa trái, 2–3 từ cực to nửa phải; không nhãn/số tập
 * (bản chủ kênh làm tay không nhãn được vidIQ chấm 98).
 */
/** `src`: ảnh nền có sẵn (vd ảnh cảnh đầu) — dựng thẳng bằng ffmpeg, KHÔNG gọi AI vẽ (dự phòng khi hết lượt vẽ). */
export async function thumbnail(dir: string, prompt: string, text: string, variant: { name?: string; seed?: number; refs?: string[]; layout?: BlastLayout; src?: string } = {}) {
  const name = variant.name ?? "thumbnail";
  const img = variant.src ?? path.join(dir, `${name}-src.jpg`);
  if (!variant.src) await drawImage(`${prompt}, YouTube thumbnail, 16:9`, img, { width: 1280, height: 720, seed: variant.seed ?? 42, refs: variant.refs });
  const out = path.join(dir, `${name}.jpg`);
  const draw = BURN_TEXT ? blastFilter(text, variant.layout) : "";
  await ffmpeg(["-i", img, "-vf", `${LOGO_CROP}scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720:(iw-ow)/2:(ih-oh)*0.3,eq=contrast=1.12:saturation=1.25,unsharp=5:5:0.8${draw}`, "-q:v", "2", out]);
  return out;
}

/** Giọng đọc nén nhẹ (mono 64k) để nghe thử trên màn flow — file WAV gốc quá nặng. */
async function previewAudio(wav: string, out: string) {
  await ffmpeg(["-i", wav, "-ac", "1", "-c:a", "aac", "-b:a", "64k", out]);
  return out;
}

/** Upload phụ (ảnh cảnh, giọng nghe thử): lỗi chỉ cảnh báo, không làm hỏng render. */
async function uploadPreview(videoId: number, releaseId: number | null, file: string, name?: string) {
  return uploadAsset(videoId, releaseId, file, name).then(
    () => true,
    (e) => {
      console.warn("⚠ Upload xem trước lỗi:", e instanceof Error ? e.message : e);
      return false;
    },
  );
}

/** Prompt đã gửi AI, cắt gọn để lưu vào tiến độ. */
function clip(req: { system: string; prompt: string }) {
  return `[system] ${req.system}\n\n${req.prompt}`.slice(0, 4000);
}

/** Cache cảnh/ảnh của video chương gắn với số ảnh `n`: đổi cách chia (vd chuyển sang chế độ tập) thì bỏ ảnh/cảnh cũ — ảnh lệch lời đọc. */
async function resetStaleScenes(dir: string, plan: string) {
  const marker = path.join(dir, "scene-plan.txt");
  if ((await readFile(marker, "utf8").catch(() => "")) === plan) return;
  for (const f of await readdir(dir).catch(() => [] as string[])) if (/^long-(img-\d+\.jpg|shot|group|silent|seg|clip|i2v)/.test(f)) await rm(path.join(dir, f), { force: true });
  await writeFile(marker, plan);
}

/**
 * Video chương của chế độ tập: chỉ là nguyên liệu để ghép tập (không đăng lẻ, không Short, không thumbnail, không SEO/vidIQ,
 * không playlist, không upload xem trước). Giọng + ảnh (1 ảnh/60 giây) + video ảnh tĩnh (buildStillVideo); xong thì `ready`, chờ ghép.
 */
async function renderInternalChapter(o: { videoId: number; s: Series; c: Chapter; dir: string; track: Tracker; releaseId: number | null }) {
  const { videoId, s, c, dir, track, releaseId } = o;
  track.start("agent", { long: 1 });
  // Ngoại hình + ảnh mẫu nam chính CỐ ĐỊNH cả bộ (hero.ts) — hết cảnh nào mặt nấy.
  const hero = await heroRef(s, dir);
  const look = { characterLook: hero.look };
  track.model("agent", textProvider().lastModel);
  const music = await pickMusic(videoId);
  const credit = music ? `\n\n${musicCredit(music)}` : "";
  const meta: VideoMeta = {
    title: `Chương ${c.number}: ${c.title}`,
    description: `Nguyên liệu của tập — không đăng lẻ.${credit}`,
    tags: [], shortTitle: "", shortDescription: "",
  };
  await db().update(videos).set({ meta }).where(eq(videos.id, videoId));

  // Không đọc "Tên truyện. Chương N: …" ở đầu: người xem từ đề xuất thoát ngay ở câu đọc máy đó. Tập tự mở bằng đoạn cao trào + câu chuyển.
  const longText = c.content;
  track.start("tts", { long: ttsChunks(longText).length });
  track.log("tts", `Giọng ${s.ttsVoice}`);
  console.log("● Chương nội bộ: đọc giọng");
  const long = await narrate(longText, dir, s.ttsVoice, (i, total) => track.tick("tts", "long", `Đoạn ${i + 1}/${total}`));
  track.finish("tts");

  // 2 phút đầu ~6 giây/ảnh (zoom nhẹ), phần sau 1 ảnh/30 giây; lời cảnh lấy theo cue đang đọc trong khoảng của ảnh.
  // Chương mở đầu tập: nhịp nhanh + dày clip tới phút 15 (vùng giữ chân của cả tập).
  const opener = s.episodeChapters > 0 && (await episodeOpener(s.id, c.number, s.episodeChapters).catch(() => false));
  if (opener) console.log("  Chương mở đầu tập — 15 phút đầu nhịp nhanh, nhiều clip động");
  // Đổi ảnh đúng lúc HẾT CÂU (không cắt giữa câu) — hình mới đi cùng câu mới.
  const spans = snapToSentences(planChapterScenes(long.seconds, opener), long.cues);
  const n = spans.length;
  const planTag = `fast-${n}`;
  await resetStaleScenes(dir, planTag);
  const scenes = spans.map((sp) => ({ ...sp, text: cueTextBetween(long.cues, sp.start, sp.end) }));
  const prompts = await cached(path.join(dir, `long-scenes-${planTag}.json`), () => scenePrompts(look.characterLook, scenes.map((x) => x.text)));
  track.tick("agent", "long", `${n} prompt cảnh`);
  track.finish("agent");

  track.set({ prompts: { scenes: clip(scenesRequest(look.characterLook, scenes.map((x) => x.text))) } });
  track.start("images", { long: n });
  track.start("video");
  // Như video thường: ghi AI vẽ đã dùng + gửi từng ảnh lên kho để màn flow có "Ảnh từng cảnh" xem trước.
  const imageModels = new Set<string>();
  // Chương mở tập: đầu video động LIỀN MẠCH như phim (cảnh nối 2–3 đoạn clip), các chương sau rải clip như cũ.
  const i2v = newI2vRun({ videoId, dir, track, scenes, prompts, logoCrop: LOGO_CROP, limits: opener ? OPENER_CLIPS : undefined, continuous: opener ? OPENER_SEGMENT_BUDGET : undefined });
  if (i2v) track.start("i2v", { long: i2v.picks.length });
  const zimage = newZImageRun({ videoId, dir, scenes, prompts: prompts.map((p) => p.prompt), exclude: i2v?.picks ?? [], log: (t) => track.log("images", t) });
  const video = await buildStillVideo({
    dir, name: "long", narration: long, prompts, scenes, music, i2v, zimage, heroRef: hero.file,
    w: 1920, h: 1080, imgW: 1280, imgH: 768,
    on: {
      clips: async (clips, failure) => {
        for (const [scene, file] of clips) await uploadPreview(videoId, releaseId, file, i2v!.assetName(scene));
        if (failure && !clips.size) return void track.finish("i2v", "error", failure);
        if (failure) track.warn("i2v", failure);
        track.finish("i2v");
      },
      image: async (i, file, model) => {
        if (model && !imageModels.has(model)) {
          imageModels.add(model);
          track.model("images", [...imageModels].map((m) => m.replace(/^@cf\/[^/]+\/|^black-forest-labs\//, "")).join(" + "));
        }
        if (await uploadPreview(videoId, releaseId, file)) track.sceneFile("long", i, path.basename(file));
        track.tick("images", "long", `Ảnh ${i + 1}/${n} xong`);
      },
      shots: (count) => track.total("video", "long", count),
      shot: () => track.tick("video", "long"),
      log: (text) => track.log("video", text),
    },
  });
  track.finish("images");
  track.log("video", "Upload file lên kho");
  await uploadAsset(videoId, releaseId, video.out);
  track.finish("video");
  await track.flush();
  await db()
    .update(videos)
    .set({ status: "ready", meta, durationSec: Math.round(long.seconds), publishAt: null, uploadStatus: "none", updatedAt: new Date() })
    .where(eq(videos.id, videoId));
  if (process.env.GITHUB_ACTIONS) await rm(dir, { recursive: true, force: true });
  console.log(`✔ Xong chương nội bộ #${videoId} (${Math.round(long.seconds / 60)} phút, ${n} ảnh)`);
}


export async function renderVideo(videoId: number) {
  // Key dán trên trang Cài đặt AI (lưu DB) — dùng được ngay mà không cần thêm GitHub Secrets.
  await loadSecrets(true);
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v) throw new Error(`Không có video #${videoId}`);
  const [c] = await db().select().from(chapters).where(eq(chapters.id, v.chapterId));
  const [s] = await db().select().from(series).where(eq(series.id, c.seriesId));
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  // Giữ chỗ nguyên tử: job render.yml và job daily có thể cùng nhặt 1 video → chỉ một job được render (tránh đăng trùng YouTube).
  const claimed = await db()
    .update(videos)
    .set({
      status: "rendering", error: null, runUrl, progress: { steps: {} }, updatedAt: new Date(),
      ...(v.youtubeVideoId ? {} : { uploadStatus: "none" as const, uploadError: null }),
    })
    // Nhận: hàng đợi; "failed" (lỗi mạng… — chạy render là chủ ý render lại); kẹt "rendering" quá 30 phút (job trước bị huỷ).
    .where(and(eq(videos.id, videoId), or(eq(videos.status, "queued"), eq(videos.status, "failed"), and(eq(videos.status, "rendering"), lt(videos.updatedAt, new Date(Date.now() - 30 * 60_000))))))
    .returning({ id: videos.id });
  if (!claimed.length) {
    console.log(`⏭ Video #${videoId} không ở hàng đợi (đang được job khác render hoặc đã xong) — bỏ qua.`);
    return;
  }

  const track = new Tracker(videoId);
  // Giữ thư mục giữa các lần chạy (được cache trên Actions) để không tốn lại quota TTS/ảnh đã làm.
  const dir = path.resolve(`.render/video-${videoId}`);
  const shortDir = path.join(dir, "short");
  await mkdir(shortDir, { recursive: true });
  /** Release của lần chạy này — lỗi giữa chừng (hết lượt/credit…) vẫn lưu phần giọng đã đọc. */
  let ttsRelease: number | null = null;
  try {
    console.log(`▶ Video #${videoId}: ${s.title} — chương ${c.number}`);
    // Hết quota ảnh đẹp thì chờ 7h sáng (lần chạy 00:17 UTC) thay vì ra video ảnh mờ Pollinations.
    // Video đã vẽ dở (ảnh nằm trong cache) thì cứ chạy: ảnh có sẵn không tốn quota, thiếu ảnh thì drawImage tự báo hết quota.
    let hasImages = (await readdir(dir).catch(() => [] as string[])).some((f) => /-img-\d+\.jpg$/.test(f));
    // Cache mất ảnh nhưng release cũ còn → tải về TRƯỚC khi ensureRelease xoá release (không vẽ lại ảnh đã có).
    if (!hasImages) {
      const n = await restoreImages(videoId, dir, shortDir);
      if (n) console.log(`  Lấy lại ${n} ảnh có sẵn từ release — không vẽ lại`);
      hasImages = n > 0;
    }
    if (!hasImages && !(await imagesReady())) throw new QuotaExhaustedError("Hết lượt vẽ ảnh (GPT gói Plus) — chờ lượt sau.");
    // Giọng đã trả tiền nằm trên release (saveTts) mà cache mất → tải về trước khi ensureRelease xoá release.
    const restoredTts = await restoreTts(videoId, dir);
    if (restoredTts) console.log(`  Lấy lại ${restoredTts} file giọng đã đọc từ release — không đọc lại (không tốn tiền)`);
    // Video đã lên YouTube thì giữ release cũ (thay dần từng file); chưa thì làm sạch để xem tiến độ từ đầu.
    const releaseId = await ensureRelease(videoId, !v.youtubeVideoId);
    ttsRelease = releaseId;
    if (s.episodeChapters > 0) {
      // QC đòi render lại từ đầu: bỏ video/đoạn/kế hoạch cảnh cũ (giọng TTS cache vẫn dùng lại) rồi dựng theo cách mới.
      if (v.meta?.forceRerender) {
        console.log("  Render lại từ đầu (bộ kiểm chất lượng yêu cầu)");
        for (const f of await readdir(dir).catch(() => [] as string[])) if (/^long(\.mp4|-seg|-segments|-shot|-group|-silent)|^scene-plan\.txt$/.test(f)) await rm(path.join(dir, f), { force: true });
      }
      await renderInternalChapter({ videoId, s, c, dir, track, releaseId });
      // Chỉ trộn cờ vào meta hiện tại (render vừa ghi meta mới — đừng ghi đè bằng bản đọc lúc đầu).
      if (v.meta?.forceRerender) await db().update(videos).set({ meta: sql`${videos.meta} || '{"forceRerender": false}'::jsonb` }).where(eq(videos.id, videoId));
      return;
    }
    const wantShort = s.makeShort;
    /** Kênh chuyện đời: truyện độc lập, prompt/ảnh/SEO riêng (src/lib/story/life.ts). */
    const life = isLifeStory(s);
    // Chuyện đời hay được sửa tay rồi render lại: cache meta/cảnh gắn với nội dung truyện để bản sửa không dùng lại meta cũ.
    const tag = life ? `-${createHash("sha1").update(c.content).digest("hex").slice(0, 8)}` : "";
    // Chuyện đời kể ngôi "tôi": giọng theo giới tính người kể (mẹ kể → giọng nữ), không cố định theo bộ.
    const voice = life ? lifeVoice(c.content, c.title) : s.ttsVoice;
    if (life) {
      // Truyện đã sửa từ lần render trước → bỏ đoạn video/Short cũ; GIỮ ảnh đã vẽ (user chốt: không vẽ lại) và giọng tts-* (tự kiểm theo văn bản).
      const markFile = path.join(dir, "content.tag");
      const prev = await readFile(markFile, "utf8").catch(() => null);
      if (prev !== tag) {
        for (const f of await readdir(dir).catch(() => [] as string[])) {
          if (!/^tts-|^vidiq-|\.tag$|-img-\d+\.jpg$|^short$/.test(f)) await rm(path.join(dir, f), { recursive: true, force: true });
        }
        await mkdir(shortDir, { recursive: true });
        for (const f of await readdir(shortDir)) if (!/-img-\d+\.jpg$/.test(f)) await rm(path.join(shortDir, f), { recursive: true, force: true });
        console.log("  Truyện đã sửa — dựng lại giọng/video (giữ ảnh đã vẽ)");
      }
      await writeFile(markFile, tag);
    }

    // ── AI Agent: tiêu đề, mô tả, kịch bản Short. Prompt ảnh làm sau khi có giọng đọc (chia cảnh theo thời gian).
    track.start("agent", { long: 2, ...(wantShort ? { short: 1 } : {}) });
    // vidIQ (nếu có key): từ khóa thật cho tiêu đề/mô tả/tag. Cache để chạy lại không tốn credit.
    const seo = process.env.VIDIQ_API_KEY
      ? await cached(path.join(dir, "vidiq-keywords-vn.json"), async () => {
          track.log("agent", "vidIQ: nghiên cứu từ khóa theo thể loại (VN)");
          return keywordResearch(genreSeeds(s.genre));
        })
      : null;
    if (seo) track.log("agent", `vidIQ: từ khóa ${seo.keywords.slice(0, 5).map((k) => `${k.keyword} (${k.overall})`).join(", ")}`);
    const searchKeywords = seo?.keywords.map((k) => k.keyword) ?? [];
    // Mẫu tiêu đề/thumbnail đang ăn view (quét xu hướng trong 7 ngày) — không có thì SEO như cũ.
    const trendHints = seoHints(freshInsights(await loadTrends()));
    track.set({ prompts: { meta: clip(metaRequest(s, c, seo?.text, trendHints)) } });
    const m = await cached(path.join(dir, `meta-v2${tag}.json`), () => videoMeta(s, c, seo?.text, trendHints));
    track.model("agent", textProvider().lastModel);
    // vidIQ chấm điểm tiêu đề gốc + 2 phương án (đều theo khuôn giật tít) → lấy tiêu đề điểm cao nhất.
    // Chuyện đời: tiêu đề truyện do chủ kênh đặt sẵn theo khuôn kênh — dùng nguyên (AI hay bịa chi tiết không có trong truyện).
    let title = life ? c.title : m.title;
    let seoInfo: VideoMeta["seo"];
    const options = (life ? [c.title] : [m.title, ...(m.titleAlternatives ?? [])]).filter(Boolean);
    if (process.env.VIDIQ_API_KEY && options.length > 1) {
      const scores = await cached(path.join(dir, "vidiq-titles-v2.json"), () => scoreTitles(options));
      const all = options.map((t, i) => ({ title: t, score: scores?.[i] ?? null }));
      if (all.some((x) => x.score != null)) {
        const best = chooseTitle(all);
        title = best.title;
        seoInfo = { titleScore: best.score, titleOptions: all, keywords: searchKeywords };
        track.log("agent", `vidIQ chấm tiêu đề: ${all.map((x) => `${x.score ?? "?"} — ${x.title}`).join(" | ")}`.slice(0, 600));
      }
    }
    track.tick("agent", "long", `Tiêu đề: ${title}`);
    const draft: VideoMeta = {
      title: title.length > 100 ? `${title.slice(0, 97)}…` : title,
      description: `${m.description}\n\n${AI_NOTE}`,
      tags: m.tags,
      shortTitle: m.shortTitle,
      shortDescription: m.shortDescription,
      ...(seoInfo ? { seo: seoInfo } : searchKeywords.length ? { seo: { keywords: searchKeywords } } : {}),
    };
    // Magic fill: điểm SEO tổng < 90 thì AI sửa đúng tiêu chí đang mất điểm (tối đa 3 lượt). Cache để chạy lại không tốn lượt.
    const fixed = await cached(path.join(dir, `meta-seo-v2${tag}.json`), () =>
      optimizeMeta(draft, { seriesTitle: life ? c.title : s.title, chapterNumber: c.number, chapterTitle: c.title, summary: c.summary, life }, { log: (t) => track.log("agent", t) }),
    );
    // Chuyện đời: nền nhạc cảm xúc ghép nhiều bài (chủ kênh 20/11/2026 muốn có nhạc; trước đó 18/11 chốt không nhạc).
    let music = life ? null : await pickMusic(videoId);
    const lifeTracks = life ? await lifeMusicTracks() : [];
    // Ghi công nhạc nền (bắt buộc với CC BY) — gắn sau bước tối ưu SEO để AI không xoá mất.
    const credit = life ? lifeMusicCredit(lifeTracks) : music ? musicCredit(music) : "";
    let meta: VideoMeta = credit
      ? { ...fixed.meta, description: `${fixed.meta.description}\n\n${credit}`, shortDescription: `${fixed.meta.shortDescription}\n\n${credit}` }
      : fixed.meta;
    track.log("agent", fixed.rounds ? `Điểm SEO: ${fixed.from} → ${fixed.score} sau ${fixed.rounds} lượt tối ưu` : `Điểm SEO: ${fixed.score} (đạt)`);
    await db().update(videos).set({ meta }).where(eq(videos.id, videoId));

    // ── Giọng đọc
    const longText = chapterNarration(c.content);
    track.start("tts", { long: ttsChunks(longText).length, ...(wantShort ? { short: ttsChunks(m.shortScript).length } : {}) });
    track.log("tts", `Giọng ${voice}`);
    console.log("● Video dài: đọc giọng");
    const onLong = (i: number, total: number) => track.tick("tts", "long", `Đoạn ${i + 1}/${total}`);
    let long: Narration | undefined;
    // Chuyện đời: người kể giọng già đúng giới tính, mỗi nhân vật có thoại một giọng đúng giới tính; cảm xúc theo TỪNG LƯỢT
    // do AI đạo diễn gắn (nghẹn, uất, run…). KHÔNG thẻ <sigh>… trong chữ (bản #66 đọc lẫn thẻ hơi thở). Tăng nhẹ tốc độ.
    const lifeGroups = (text: string) =>
      ttsChunks(stripTags(text)).map((ch) => [{ speaker: NARRATOR, voice, style: LIFE_NARRATOR_STYLE, text: ch.join(" ") }]);
    // Có key ivoi → chuyện đời đọc bằng ivoi: người kể giọng user chọn, nhân vật có thoại giọng ivoi thường theo giới/tuổi.
    const ivoiVoice = life && ivoiReady() ? `${IVOI_PREFIX}${voice === LIFE_TTS_VOICE_FEMALE ? IVOI_VOICE_FEMALE : IVOI_VOICE_MALE}` : null;
    let useIvoi = Boolean(ivoiVoice);
    const directed = life
      ? await cached(path.join(dir, `voice-script${tag}.json`), () => directScript(longText).catch((e) => {
          if (e instanceof QuotaExhaustedError) throw e;
          console.warn("  ⚠ Đạo diễn cảm xúc lỗi:", e instanceof Error ? e.message : e);
          return null;
        }))
      : null;
    if (life && useIvoi) {
      const narratorId = ivoiVoice!.slice(IVOI_PREFIX.length);
      // Phân vai (kịch bản AI chia lời — Gemini free, cache theo nội dung). Không có kịch bản → một giọng người kể.
      const cast = directed
        ? castVoices({ ...directed, narrator: { gender: narratorId === IVOI_VOICE_FEMALE ? "female" : "male", age: 60 } }, IVOI_VOICES)
        : null;
      if (cast) cast[NARRATOR] = narratorId;
      try {
        if (directed && cast) {
          const segments = ivoiSegments(directed.turns, cast, IVOI_MAX_CHARS - 1000);
          track.log("tts", `ivoi phân vai: ${Object.entries(cast).map(([k, v]) => `${k === NARRATOR ? "người kể" : k}=${v}`).join(", ")} · ${segments.length} lượt gọi`);
          track.total("tts", "long", segments.length);
          long = await narrateScript(
            segments.map((x) => [{ speaker: NARRATOR, voice: `${IVOI_PREFIX}${x.voice}`, style: "", text: x.text, speed: x.speed, pauseAfter: x.pauseAfter }]),
            dir, ivoiVoice!, onLong, 70, 1,
          );
        } else {
          track.log("tts", `Giọng ivoi ${narratorId} (một giọng — không có kịch bản phân vai)`);
          long = await narrate(stripTags(longText), dir, ivoiVoice!, onLong, 70, 1);
        }
      } catch (e) {
        if (!(e instanceof IvoiUnavailableError)) throw e;
        // Hết credit / key lỗi → đọc bằng Gemini, không treo video.
        track.warn("tts", `ivoi không dùng được (${e.message}) — quay về Gemini`);
        useIvoi = false;
      }
    }
    if (long) {
      // đã đọc bằng ivoi
    } else if (life) {
      // Người kể: giới tính theo tiêu đề (lifeVoice — AI từng đoán nhầm bà mẹ thành nam), luôn nhóm tuổi già (Gacrux/Algenib).
      // Nhân vật có thoại: giọng theo giới tính/tuổi AI đọc ra, không trùng giọng người kể.
      const cast = directed
        ? castVoices({ ...directed, narrator: { gender: voice === LIFE_TTS_VOICE_FEMALE ? "female" : "male", age: Math.max(60, directed.narrator.age) } })
        : null;
      if (cast) cast[NARRATOR] = voice;
      const groups = directed && cast
        ? groupTurns(directed.turns, cast).map((g) =>
            g.map((t) => {
              const narrator = t.speaker === NARRATOR || !cast[t.speaker];
              return {
                speaker: narrator ? NARRATOR : t.speaker,
                voice: narrator ? voice : cast[t.speaker],
                style: narrator ? `${LIFE_NARRATOR_STYLE}. This passage: ${t.style}` : `natural Vietnamese speech, ${t.style}`,
                text: stripTags(t.text),
              };
            }),
          )
        : lifeGroups(longText);
      track.log("tts", cast ? `Phân vai: ${Object.entries(cast).map(([k, v]) => `${k === NARRATOR ? "người kể" : k}=${v}`).join(", ")}` : `Một giọng người kể ${voice}`);
      track.total("tts", "long", groups.length);
      long = await narrateScript(groups, dir, voice, onLong, 70, LIFE_TEMPO);
    } else {
      long = await narrate(longText, dir, voice, onLong);
    }
    if (ivoiReusedCount()) console.log(`  ivoi: ${ivoiReusedCount()} đoạn lấy lại từ job đã trả tiền — không đọc lại`);
    await saveTts(videoId, releaseId, dir).catch((e) => console.warn("⚠ Lưu giọng vào release lỗi:", e instanceof Error ? e.message : e));
    await uploadPreview(videoId, releaseId, await previewAudio(long.audio, path.join(dir, "narration.m4a")));
    let short: Narration | null = null;
    if (wantShort) {
      try {
        const onShort = () => track.tick("tts", "short");
        short = life && useIvoi
          ? await narrate(stripTags(m.shortScript), shortDir, ivoiVoice!, onShort, 34, 1)
          : life ? await narrateScript(lifeGroups(m.shortScript), shortDir, voice, onShort, 34, LIFE_TEMPO) : await narrate(m.shortScript, shortDir, voice, onShort, 34);
        await uploadPreview(videoId, releaseId, await previewAudio(short.audio, path.join(shortDir, "short-narration.m4a")));
      } catch (e) {
        if (e instanceof QuotaExhaustedError) throw e;
        track.warn("tts", `Short lỗi giọng đọc: ${e instanceof Error ? e.message : e}`);
      }
    }
    track.finish("tts");

    // ── AI Agent: prompt ảnh từng cảnh.
    // 1 ảnh ~25s (tách ~2–3 cảnh), tối đa 30 ảnh để vừa quota Cloudflare free 1 ngày (imageCount).
    // Chuyện đời ít hành động: 1 ảnh ~40s, tối đa 18 ảnh (10 phút ≈ 15 ảnh).
    const n = life ? Math.min(LIFE_MAX_IMAGES, Math.max(6, Math.round(long.seconds / LIFE_IMAGE_SECONDS))) : imageCount(long.seconds, false);
    const longScenes = splitScenes(long.cues, n, long.seconds);
    track.set({ prompts: { meta: clip(metaRequest(s, c, undefined, trendHints)), scenes: clip(scenesRequest(m.characterLook, longScenes.map((x) => x.text), life)) } });
    const longPrompts = await cached(path.join(dir, `long-scenes-${n}${tag}.json`), () => scenePrompts(m.characterLook, longScenes.map((x) => x.text), life));
    track.tick("agent", "long", `${n} prompt cảnh video dài`);
    let shortScenes = short ? splitScenes(short.cues, shortSceneCount(short.seconds), short.seconds) : [];
    let shortPrompts: ScenePrompt[] = [];
    if (short) {
      try {
        const raw = await cached(path.join(shortDir, `scenes${tag}.json`), () => scenePrompts(m.characterLook, shortScenes.map((x) => x.text), life));
        shortPrompts = raw.map((p) => ({ ...p, prompt: `${p.prompt}, vertical portrait composition` }));
        track.tick("agent", "short", `${shortScenes.length} prompt cảnh Short`);
      } catch (e) {
        if (e instanceof QuotaExhaustedError) throw e;
        track.warn("agent", `Bỏ qua Short — lỗi prompt cảnh: ${e instanceof Error ? e.message : e}`);
        short = null;
      }
    }
    if (!short) shortScenes = [];
    track.model("agent", textProvider().lastModel);
    track.finish("agent");

    const scene = (sc: { start: number; end: number; text: string }, p: ScenePrompt, i: number) => ({
      i, start: sc.start, end: sc.end, text: sc.text.slice(0, 400), prompt: p.prompt, action: p.action,
    });
    track.set({
      scenes: { long: longScenes.map((sc, i) => scene(sc, longPrompts[i], i)), short: shortScenes.map((sc, i) => scene(sc, shortPrompts[i], i)) },
    });

    // ── Vẽ ảnh + dựng video chạy đan xen: shot nào có ảnh là dựng luôn.
    track.start("images", { long: n, ...(short ? { short: shortScenes.length } : {}) });
    track.start("video");
    // AI vẽ thực sự đã dùng (Cloudflare, rồi DeepInfra khi hết quota…) — hiện trên node Vẽ ảnh và trang Hạn mức AI.
    const imageModels = new Set<string>();
    const hooks = (which: "long" | "short") => {
      const label = which === "long" ? "Dài" : "Short";
      return {
        image: async (i: number, file: string, model?: string) => {
          if (model && !imageModels.has(model)) {
            imageModels.add(model);
            track.model("images", [...imageModels].map((m) => m.replace(/^@cf\/[^/]+\/|^black-forest-labs\//, "")).join(" + "));
          }
          if (await uploadPreview(videoId, releaseId, file)) track.sceneFile(which, i, path.basename(file));
          track.tick("images", which, `${label} · ảnh ${i + 1} xong`);
        },
        shots: (count: number) => track.total("video", which, count),
        shot: () => track.tick("video", which),
        log: (text: string) => track.log("video", `${label}: ${text}`),
      };
    };
    if (life) music = await lifeMusicBed(dir, long.seconds, videoId);
    const longVideo = await buildVideo({
      dir, name: "long", narration: long, prompts: longPrompts, scenes: longScenes,
      w: 1920, h: 1080, imgW: 1280, imgH: 768, fontSize: 62, marginV: 70,
      // Chuyện đời vào thẳng biến cố — không thẻ tên kênh/số chương ở đầu video.
      titleCard: life ? undefined : `${s.title}\n\nChương ${c.number}: ${c.title}`,
      // Chuyện đời: nhạc nhỏ dưới giọng, tự hạ khi kể (không có bài nào thì chỉ giọng).
      music, noMusic: life && !music, ...(life ? { musicGain: 0.22, duck: true } : {}),
      on: hooks("long"),
    });

    // Short và thumbnail là phụ: lỗi thì vẫn xuất video dài thay vì bỏ cả lần render.
    const extras: string[] = [];
    if (short) {
      try {
        console.log("● Short");
        const shortVideo = await buildVideo({
          dir: shortDir, name: "short", narration: short, prompts: shortPrompts, scenes: shortScenes,
          w: 1080, h: 1920, imgW: 768, imgH: 1408, fontSize: 80, marginV: 520,
          hook: m.thumbnailText, progressBar: true, music, noMusic: life,
          on: hooks("short"),
        });
        extras.push(shortVideo.out);
      } catch (e) {
        if (e instanceof QuotaExhaustedError) throw e;
        console.warn("⚠ Bỏ qua Short:", e instanceof Error ? e.message : e);
        track.warn("video", `Bỏ qua Short: ${e instanceof Error ? e.message : e}`);
      }
    } else if (!wantShort) track.log("video", "Bộ truyện đang tắt làm Short");

    console.log("● Thumbnail");
    track.log("images", "Vẽ thumbnail");
    const thumb = await thumbnail(dir, `${m.thumbnailPrompt}, ${m.characterLook}`, m.thumbnailText).catch(async (e) => {
      console.warn("⚠ Thumbnail AI lỗi, dùng ảnh đầu video:", e instanceof Error ? e.message : e);
      track.warn("images", "Thumbnail AI lỗi — dùng ảnh đầu video");
      return thumbnail(dir, "", m.thumbnailText, { src: path.join(dir, "long-img-0.jpg") });
    });
    track.finish("images");
    // Mô tả đủ checklist vidIQ: mục lục theo mốc giọng đọc thật, link danh sách phát / chương trước, hashtag.
    const pl = await seriesPlaylist(s.id);
    meta = await enrichDescription(meta, {
      segments: segmentsFromCues(long.cues, long.seconds), seriesId: s.id, chapterNumber: c.number,
      keywords: meta.seo?.keywords, links: pl ? [`📜 Nghe trọn bộ theo thứ tự: ${playlistUrl(pl)}`] : [],
    });
    const metaFile = path.join(dir, "youtube.txt");
    await writeFile(metaFile, `${meta.title}\n\n${meta.description}\n\nTags: ${meta.tags.join(", ")}\n\n--- SHORT ---\n${meta.shortTitle}\n\n${meta.shortDescription}\n`);

    track.log("video", "Upload file lên kho");
    for (const f of [longVideo.out, ...extras, thumb, metaFile]) await uploadAsset(videoId, releaseId, f);
    track.finish("video");
    await track.flush();

    // Đã có trên YouTube (render lại sau khi đăng): giữ lịch + trạng thái cũ, YouTube vẫn giữ bản đã upload.
    const onYoutube = Boolean(v.youtubeVideoId);
    if (onYoutube) track.log("video", "Video đã có trên YouTube — YouTube giữ bản cũ, bản mới chỉ để tải về");
    // Lịch cũ đã qua (render lại muộn) thì lấy khung giờ mới.
    const publishAt = onYoutube && v.publishAt ? v.publishAt : await keepOrNextSlot(v.publishAt, s.channel);
    const publish = !onYoutube && (await autoPublishEligible(videoId));
    // `ready` và `uploading` ghi cùng lúc để màn flow không ngừng cập nhật trực tiếp giữa hai bước.
    await db()
      .update(videos)
      .set({
        status: onYoutube ? "published" : "ready", meta, durationSec: Math.round(long.seconds), publishAt, updatedAt: new Date(),
        ...(publish ? { uploadStatus: "uploading" as const, uploadError: null } : {}),
      })
      .where(eq(videos.id, videoId));
    await notify(
      `🎬 <b>Video sẵn sàng</b>\n${escapeHtml(meta.title)}\n` +
        `⏱ ${Math.round(long.seconds / 60)} phút${extras.length ? " + Short" : ""}\n` +
        `📅 Lịch đăng: ${publishAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}\n` +
        `👉 ${WEB_URL}/videos/${videoId}`,
    );
    // Lỗi đăng không làm hỏng video đã render (publishToYoutube tự bắt lỗi → failed).
    if (publish) await publishToYoutube(videoId, { long: longVideo.out, short: extras[0], thumb });
    if (process.env.GITHUB_ACTIONS) await rm(dir, { recursive: true, force: true });
    console.log(`✔ Xong video #${videoId} (${Math.round(long.seconds / 60)} phút)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Hết quota thì trả về hàng đợi — job 3 tiếng/lần sẽ làm tiếp từ phần đã cache.
    // Lỗi giữa chừng (hết credit/lượt, mạng…) → giữ phần giọng đã trả tiền trên release.
    await saveTts(videoId, ttsRelease, dir).catch(() => {});
    const status = e instanceof QuotaExhaustedError ? "queued" : "failed";
    await (status === "queued" ? track.pause(msg) : track.fail(msg));
    await db().update(videos).set({ status, error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(videos.id, videoId));
    if (status === "failed") {
      await notify(`❌ <b>Render lỗi</b> video #${videoId} — chương ${c.number}\n${escapeHtml(msg.slice(0, 300))}\n${runUrl ?? ""}\n👉 ${WEB_URL}/videos/${videoId}`);
    }
    throw e;
  }
}

// CLI: tsx pipeline/render.ts <videoId>  |  "seo:<videoId>" = chỉ làm lại SEO + cập nhật YouTube (không render)
// |  "compile:<seriesId>" = gộp các chương đã render thành video dài 1–2 giờ  |  "trends" = quét xu hướng YouTube (vidIQ + AI)  |  "shorts" = bù Short cho tập thiếu  |  "clips[:N]" = làm N Short cắt cảnh từ chương (mặc định 2).
if (process.argv[1]?.endsWith("render.ts")) {
  const arg = process.argv[2] ?? "";
  const runJob = () => {
    if (arg.startsWith("seo:")) return import("./seo-redo").then((x) => x.redoSeo(Number(arg.slice(4))));
    if (arg.startsWith("setpublish:")) {
      const [, id, iso] = arg.match(/^setpublish:(\d+):(.+)$/) ?? [];
      return import("./schedule").then((x) => x.setPublishAt(Number(id), new Date(iso)));
    }
    if (arg === "rotate") return import("./schedule").then((x) => x.rotateSchedule());
    if (arg === "reschedule") return import("./schedule").then((x) => x.rescheduleToPublishHour());
    if (arg.startsWith("playlist:")) return import("./playlist").then((x) => x.backfillPlaylist(Number(arg.slice(9))));
    if (arg.startsWith("clips")) {
      // clips[:N] = làm ngay N Short cắt cảnh (mặc định 2), bỏ trần theo ngày.
      const n = Number(arg.match(/^clips(?::(\d+))?$/)?.[1] ?? 2);
      return import("./clips").then((x) => x.makeSceneClips({ max: n, ignoreDailyCap: true }));
    }
    if (arg === "kaggle-test") return import("./i2v").then((x) => x.kaggleTest(process.argv[3] ?? "/tmp/i2v-in"));
    // i2v-sweep = dò tham số clip động trong 1 lượt Kaggle rồi in bảng YDIF/SSIM (xem i2v-sweep.ts).
    if (arg === "i2v-sweep") return import("./i2v").then((x) => x.i2vSweep(process.argv[3] ?? "/tmp/i2v-in"));
    // i2v-model <ten> [dir] = tham do 1 model khac tren T4 (VRAM, giay/clip, YDIF/SSIM) truoc khi tich hop.
    if (arg === "i2v-model") return import("./i2v").then((x) => x.i2vModelProbe(process.argv[3] ?? "cogvideox5b", process.argv[4] ?? "/tmp/i2v-in"));
    if (arg === "shorts") return import("./short-backfill").then((x) => x.backfillEpisodeShorts());
    if (arg.startsWith("redo:")) {
      // redo:<id>[:<ISO lịch>][:full]
      const [, id, rest = ""] = arg.match(/^redo:(\d+)(?::(.+))?$/) ?? [];
      const full = rest.endsWith(":full") || rest === "full";
      const iso = rest.replace(/:?full$/, "");
      return import("./redo-episode").then((x) => x.redoEpisode(Number(id), iso ? new Date(iso) : undefined, full));
    }
    // hold:30,39,40 = tập chưa đạt chuẩn → riêng tư, bỏ lịch, chờ dựng lại (không xoá trên YouTube).
    if (arg.startsWith("hold:")) return import("./schedule").then((x) => x.holdEpisodes(arg.slice(5).split(",").map(Number)));
    if (arg.startsWith("promote:")) {
      const [, ep, ids] = arg.split(":");
      return import("./promote").then((x) => x.promoteEpisode(Number(ep), ids.split(",").map(Number)));
    }
    // hethong:<seriesId> = ghi luật "Thần Ấn là hệ thống" vào bible, trả chương chưa có video về dàn ý (xem he-thong.ts).
    if (arg.startsWith("hethong:")) return import("./he-thong").then((x) => x.applySystem(Number(arg.slice(8))));
    // vidiq-stats = lấy ngay số thật từ vidIQ (CTR, lượt xem, % xem) như cron Vercel, bỏ qua hạn 3 ngày.
    if (arg === "vidiq-stats") return import("@/lib/vidiq-stats").then((x) => x.syncVidiqStats(Date.now(), true)).then(console.log);
    if (arg.startsWith("thumbs:")) return import("./rethumb").then((x) => x.rethumb(Number(arg.slice(7))));
    if (arg === "trends") return import("./trends").then((x) => x.scanTrends());
    if (arg.startsWith("newseries:")) return import("./new-series").then((x) => x.newSeries(arg.slice(10).split(",")));
    if (arg === "newlife" || arg.startsWith("newlife:")) return import("./new-series").then((x) => x.newLifeSeries(arg.slice(8) || undefined));
    if (arg.startsWith("pov:")) return import("./new-series").then((x) => x.firstPerson(arg.slice(4).split(",").map(Number)));
    if (arg === "series") return import("./new-series").then((x) => x.listSeries());
    if (arg.startsWith("compile:")) return import("./compile").then((x) => x.compileSeries(Number(arg.slice(8))));
    return renderVideo(Number(arg));
  };
  runJob().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(e instanceof QuotaExhaustedError ? 0 : 1);
    },
  );
}
