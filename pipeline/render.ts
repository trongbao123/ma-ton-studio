import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { drawImage, imagesReady } from "./images";
import { duration, ffmpeg, filterPath, once, pool } from "./ffmpeg";
import { Tracker } from "./progress";
import { metaRequest, scenePrompts, scenesRequest, videoMeta } from "./prompts";
import { ensureRelease, uploadAsset } from "./release";
import { keepOrNextSlot } from "./schedule";
import { loadSecrets } from "@/lib/secrets";
import { generateTitles, genreSeeds, keywordResearch, scoreTitles } from "./vidiq";
import { AI_NOTE, optimizeMeta } from "@/lib/seo-optimize";
import { autoPublishEligible, publishToYoutube } from "./youtube";

type ScenePrompt = Awaited<ReturnType<typeof scenePrompts>>[number];
import { cuesForChunk, packChunks, sentences, toAss, type Cue } from "./text";
import { speak } from "./tts";

// Đường dẫn tương đối (ffmpeg chạy ở gốc repo): đường dẫn tuyệt đối trên Windows có "C:" làm vỡ cú pháp filter của drawtext.
const FONT_DIR = "pipeline/fonts";
const FONT = `${FONT_DIR}/BeVietnamPro-Bold.ttf`;
/** Máy local thiếu libass/drawtext thì đặt BURN_TEXT=0 để test phần còn lại. */
const BURN_TEXT = process.env.BURN_TEXT !== "0";
const FPS = 30;

type Narration = { audio: string; cues: Cue[]; seconds: number };

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
async function narrate(text: string, dir: string, voice: string, onChunk?: (i: number, total: number) => void, cueChars = 70): Promise<Narration> {
  const chunks = ttsChunks(text);
  const files = await pool(chunks, 3, async (chunk, i) => {
    const f = path.join(dir, `tts-${voice}-${String(i).padStart(3, "0")}.wav`);
    await speak(chunk.join(" "), f, voice);
    console.log(`  TTS ${i + 1}/${chunks.length}`);
    onChunk?.(i, chunks.length);
    return f;
  });
  const cues: Cue[] = [];
  let t = 0;
  for (const [i, f] of files.entries()) {
    const d = await duration(f);
    cues.push(...cuesForChunk(chunks[i], t, d, cueChars));
    t += d;
  }
  const list = path.join(dir, "tts.txt");
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
  const audio = path.join(dir, "narration.wav");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", audio]);
  return { audio, cues, seconds: t };
}

/** Chia timeline thành `n` cảnh liền nhau theo cue, trả về [start, end, text]. */
function splitScenes(cues: Cue[], n: number, total: number) {
  const span = total / n;
  return Array.from({ length: n }, (_, i) => {
    const start = i * span;
    const end = i === n - 1 ? total : (i + 1) * span;
    const text = cues.filter((c) => c.start < end && c.end > start).map((c) => c.text).join(" ");
    return { start, end, text };
  });
}

const FADE = 0.8;
/** Pollinations không key có logo ở đáy ảnh → cắt 7%. Ảnh Cloudflare sạch, không cần. */
const LOGO_CROP = process.env.CLOUDFLARE_API_TOKEN ? "" : "crop=iw:ih*0.93:0:0,";
const SHOT_SECONDS = 10;
/** Cảnh hành động chỉ cắt nhanh hơn (không rung, không chớp — người xem thấy khó chịu). */
const ACTION_SHOT_SECONDS = 5;
const MOTIONS = ["in", "left", "out", "right", "up", "in"] as const;
type Motion = (typeof MOTIONS)[number];

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
export async function shot(img: string, out: string, seconds: number, w: number, h: number, motion: Motion) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const { z, x, y } = motionExpr(motion, frames);
  await ffmpeg([
    "-loop", "1", "-i", img, "-t", seconds.toFixed(3),
    "-vf",
    `${LOGO_CROP}scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w * 2}:${h * 2}:(iw-ow)/2:(ih-oh)*0.3,unsharp=5:5:1.0,` +
      `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${FPS},format=yuv420p`,
    // File tạm (còn mã hoá lại ở bước cuối) → nén nhanh hơn, crf thấp hơn để không mất chất lượng; đỡ phút GitHub Actions.
    "-c:v", "libx264", "-preset", "superfast", "-crf", "18", "-r", String(FPS), out,
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
  dir: string; name: string; narration: Narration; prompts: ScenePrompt[]; scenes: { start: number; end: number }[];
  w: number; h: number; imgW: number; imgH: number; fontSize: number; marginV: number; titleCard?: string;
  /** Short: chữ lớn 2 giây đầu để giữ người lướt; thanh tiến độ mảnh trên đỉnh. */
  hook?: string; progressBar?: boolean;
  /** Báo tiến độ cho màn flow: ảnh vẽ xong (lần đầu), tổng số shot, từng shot xong, việc ghép. */
  on?: { image?: (i: number, file: string, model?: string) => Promise<void>; shots?: (n: number) => void; shot?: () => void; log?: (text: string) => void };
}) {
  const { dir, name, narration, prompts, scenes, w, h, on } = opts;
  // Mỗi ảnh (1 scene) tách thành nhiều cảnh ~10s với kiểu máy quay khác nhau.
  const shots = scenes.flatMap((sc, i) => {
    const action = prompts[i].action;
    const n = Math.max(1, Math.round((sc.end - sc.start) / (action ? ACTION_SHOT_SECONDS : SHOT_SECONDS)));
    const len = (sc.end - sc.start) / n;
    return Array.from({ length: n }, (_, k) => ({
      image: i, seconds: len, action,
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
        const model = await drawImage(prompts[i].prompt, img, { width: opts.imgW, height: opts.imgH, seed: 1000 + i * 7 });
        await on?.image?.(i, img, model);
      })());
    }
    return drawn.get(i)!;
  };
  // Dọn file dựng kiểu cũ (trước khi có shot2/group2/silent2) để cache .render không phình.
  const old = new RegExp(`^${name}-(shot-\\d+|group-\\d+|silent)\\.mp4$`);
  for (const f of await readdir(dir).catch(() => [] as string[])) if (old.test(f)) await rm(path.join(dir, f), { force: true });
  const files = await pool(shots, 4, async (sh, j) => {
    const img = path.join(dir, `${name}-img-${sh.image}.jpg`);
    await draw(sh.image, img);
    // Cảnh nào sẽ crossfade với cảnh sau thì kéo dài thêm FADE để tổng thời lượng vẫn khớp giọng đọc.
    const fadesNext = j % GROUP !== GROUP - 1 && j !== shots.length - 1;
    const seconds = sh.seconds + (fadesNext ? shots[j + 1].fade : 0);
    // "shot2": đổi tên khi đổi cách mã hoá để không trộn file cũ; once() → job bị huỷ chạy lại thì bỏ qua cảnh đã dựng.
    const file = path.join(dir, `${name}-shot2-${String(j).padStart(3, "0")}.mp4`);
    await once(file, (tmp) => shot(img, tmp, seconds, w, h, sh.motion));
    if (j % 10 === 0) console.log(`  ${name} cảnh ${j + 1}/${shots.length}`);
    on?.shot?.();
    return { file, seconds, fade: sh.fade, fx: sh.fx };
  });
  on?.log?.("Ghép các cảnh (crossfade)");

  const groups: string[] = [];
  for (let g = 0; g * GROUP < files.length; g++) {
    const out = path.join(dir, `${name}-group2-${g}.mp4`);
    await once(out, (tmp) => crossfadeGroup(files.slice(g * GROUP, (g + 1) * GROUP), tmp));
    groups.push(out);
  }
  const list = path.join(dir, `${name}-groups.txt`);
  await writeFile(list, groups.map((c) => `file '${c}'`).join("\n"));
  const silent = path.join(dir, `${name}-silent2.mp4`);
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
  const grade = "eq=contrast=1.05:saturation=1.08,vignette=PI/6";
  const text = BURN_TEXT
    ? `,ass=${filterPath(ass)}:fontsdir=${filterPath(FONT_DIR)}` +
      (opts.titleCard
        ? `,drawtext=fontfile=${filterPath(FONT)}:text='${escText(opts.titleCard)}':fontsize=${Math.round(w / 22)}:fontcolor=white:borderw=5:bordercolor=black@0.8:x=(w-tw)/2:y=(h-th)/2:alpha='if(lt(t,0.6),t/0.6,if(lt(t,4),1,max(0,(5-t))))':enable='lt(t,5)'`
        : "") +
      (opts.hook ? hookText(opts.hook, w) : "")
    : "";
  // Thanh tiến độ vàng mảnh trên đỉnh Short: người xem thấy còn bao lâu nên ít lướt qua.
  const bar = opts.progressBar ? `,drawbox=x=0:y=0:w='iw*t/${narration.seconds.toFixed(2)}':h=12:color=0xFFD23F@0.95:t=fill` : "";
  on?.log?.("Trộn giọng đọc, nhạc nền, phụ đề");
  const music = (await pickMusic()) ?? (await ambientBed(dir));
  const audio = [
    "-stream_loop", "-1", "-i", music,
    "-filter_complex", `[2:a]volume=${music.endsWith("ambient.wav") ? 0.25 : 0.1}[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`,
    "-map", "0:v", "-map", "[a]",
  ];
  await once(out, (tmp) =>
    ffmpeg([
      "-i", silent, "-i", narration.audio, ...audio,
      "-vf", `${grade}${text}${bar},format=yuv420p`,
      // Hạt phim làm bitrate phình (12 phút ≈ 256MB) → chặn ~5Mbps, đủ nét cho YouTube 1080p.
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", "5M", "-bufsize", "10M",
      "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", tmp,
    ]),
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

function escText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
}

/** Nhạc nền tuỳ chọn: bỏ file .mp3 (bản quyền free, vd YouTube Audio Library) vào pipeline/music/. */
async function pickMusic() {
  const dir = path.resolve("pipeline/music");
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".mp3"));
  return files.length ? path.join(dir, files[Math.floor(Math.random() * files.length)]) : null;
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

async function thumbnail(dir: string, prompt: string, text: string, chapterNo: number) {
  const img = path.join(dir, "thumb-src.jpg");
  await drawImage(`${prompt}, YouTube thumbnail, 16:9`, img, { width: 1280, height: 720, seed: 42 });
  const out = path.join(dir, "thumbnail.jpg");
  // Chữ to 2 dòng bên TRÁI (ảnh chừa trống bên trái), nền tối dần để chữ nổi; nhãn chương góc trên.
  const lines = splitThumbText(text.toUpperCase());
  const draw = BURN_TEXT
    ? `,drawbox=x=0:y=0:w=iw*0.55:h=ih:color=black@0.35:t=fill,` +
      lines
        .map((l, i) => `drawtext=fontfile=${filterPath(FONT)}:text='${escText(l)}':fontsize=${lines.length > 1 ? 118 : 136}:fontcolor=${i ? "white" : "#FFD23F"}:borderw=10:bordercolor=black:x=50:y=(h/2)-${lines.length > 1 ? 130 : 70}+${i * 140}`)
        .join(",") +
      `,drawtext=fontfile=${filterPath(FONT)}:text='CHƯƠNG ${chapterNo}':fontsize=54:fontcolor=white:box=1:boxcolor=#B91C1C:boxborderw=18:x=50:y=50`
    : "";
  await ffmpeg(["-i", img, "-vf", `${LOGO_CROP}scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720:(iw-ow)/2:(ih-oh)*0.3,eq=contrast=1.12:saturation=1.25,unsharp=5:5:0.8${draw}`, "-q:v", "2", out]);
  return out;
}

/** "NUỐT XÁC THẦN LINH" → ["NUỐT XÁC", "THẦN LINH"] — chia đôi theo số chữ để chữ thật to. */
export function splitThumbText(t: string) {
  const w = t.trim().split(/\s+/).filter(Boolean);
  if (w.length <= 2) return [w.join(" ")];
  const mid = Math.ceil(w.length / 2);
  return [w.slice(0, mid).join(" "), w.slice(mid).join(" ")];
}

/** Giọng đọc nén nhẹ (mono 64k) để nghe thử trên màn flow — file WAV gốc quá nặng. */
async function previewAudio(wav: string, out: string) {
  await ffmpeg(["-i", wav, "-ac", "1", "-c:a", "aac", "-b:a", "64k", out]);
  return out;
}

/** Upload phụ (ảnh cảnh, giọng nghe thử): lỗi chỉ cảnh báo, không làm hỏng render. */
async function uploadPreview(videoId: number, releaseId: number | null, file: string) {
  return uploadAsset(videoId, releaseId, file).then(
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

const SHORT_SCENES = 5;

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
    .where(and(eq(videos.id, videoId), eq(videos.status, "queued")))
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
  try {
    console.log(`▶ Video #${videoId}: ${s.title} — chương ${c.number}`);
    // Hết quota ảnh đẹp thì chờ 7h sáng (lần chạy 00:17 UTC) thay vì ra video ảnh mờ Pollinations.
    // Video đã vẽ dở (ảnh nằm trong cache) thì cứ chạy: ảnh có sẵn không tốn quota, thiếu ảnh thì drawImage tự báo hết quota.
    const hasImages = (await readdir(dir).catch(() => [] as string[])).some((f) => /-img-\d+\.jpg$/.test(f));
    if (!hasImages && !(await imagesReady())) throw new QuotaExhaustedError("Hết quota ảnh Cloudflare hôm nay — chờ reset 7h sáng (hoặc thêm AI vẽ khác trong Cài đặt AI).");
    // Video đã lên YouTube thì giữ release cũ (thay dần từng file); chưa thì làm sạch để xem tiến độ từ đầu.
    const releaseId = await ensureRelease(videoId, !v.youtubeVideoId);
    const wantShort = s.makeShort;

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
    track.set({ prompts: { meta: clip(metaRequest(s, c, seo?.text)) } });
    const m = await cached(path.join(dir, "meta-v2.json"), () => videoMeta(s, c, seo?.text));
    track.model("agent", textProvider().lastModel);
    // vidIQ chấm điểm tiêu đề gốc + 2 phương án, cộng thêm 3 tiêu đề vidIQ tự nghĩ (đã có điểm) → lấy tiêu đề điểm cao nhất.
    let title = m.title;
    let seoInfo: VideoMeta["seo"];
    const options = [m.title, ...(m.titleAlternatives ?? [])].filter(Boolean);
    if (process.env.VIDIQ_API_KEY && options.length > 1) {
      const scores = await cached(path.join(dir, "vidiq-titles-v2.json"), () => scoreTitles(options));
      const ideas = await cached(path.join(dir, "vidiq-generated-titles-v2.json"), () => generateTitles(m.title, m.description));
      const all = [...options.map((t, i) => ({ title: t, score: scores?.[i] ?? null })), ...ideas.filter((x) => !options.includes(x.title))];
      if (all.some((x) => x.score != null)) {
        const best = all.reduce((b, x) => ((x.score ?? -1) > (b.score ?? -1) ? x : b));
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
    const fixed = await cached(path.join(dir, "meta-seo-v2.json"), () =>
      optimizeMeta(draft, { seriesTitle: s.title, chapterNumber: c.number, chapterTitle: c.title, summary: c.summary }, { log: (t) => track.log("agent", t) }),
    );
    const meta = fixed.meta;
    track.log("agent", fixed.rounds ? `Điểm SEO: ${fixed.from} → ${fixed.score} sau ${fixed.rounds} lượt tối ưu` : `Điểm SEO: ${fixed.score} (đạt)`);
    await db().update(videos).set({ meta }).where(eq(videos.id, videoId));

    // ── Giọng đọc
    const intro = `${s.title}. Chương ${c.number}: ${c.title}.`;
    const longText = `${intro}\n${c.content}`;
    track.start("tts", { long: ttsChunks(longText).length, ...(wantShort ? { short: ttsChunks(m.shortScript).length } : {}) });
    track.log("tts", `Giọng ${s.ttsVoice}`);
    console.log("● Video dài: đọc giọng");
    const long = await narrate(longText, dir, s.ttsVoice, (i, total) => track.tick("tts", "long", `Đoạn ${i + 1}/${total}`));
    await uploadPreview(videoId, releaseId, await previewAudio(long.audio, path.join(dir, "narration.m4a")));
    let short: Narration | null = null;
    if (wantShort) {
      try {
        short = await narrate(m.shortScript, shortDir, s.ttsVoice, () => track.tick("tts", "short"), 34);
        await uploadPreview(videoId, releaseId, await previewAudio(short.audio, path.join(shortDir, "short-narration.m4a")));
      } catch (e) {
        if (e instanceof QuotaExhaustedError) throw e;
        track.warn("tts", `Short lỗi giọng đọc: ${e instanceof Error ? e.message : e}`);
      }
    }
    track.finish("tts");

    // ── AI Agent: prompt ảnh từng cảnh.
    // 1 ảnh ~25s (tách ~2–3 cảnh), tối đa 30 ảnh để vừa quota Cloudflare free 1 ngày.
    const n = Math.min(30, Math.max(6, Math.round(long.seconds / 25)));
    const longScenes = splitScenes(long.cues, n, long.seconds);
    track.set({ prompts: { meta: clip(metaRequest(s, c)), scenes: clip(scenesRequest(m.characterLook, longScenes.map((x) => x.text))) } });
    const longPrompts = await cached(path.join(dir, `long-scenes-${n}.json`), () => scenePrompts(m.characterLook, longScenes.map((x) => x.text)));
    track.tick("agent", "long", `${n} prompt cảnh video dài`);
    let shortScenes = short ? splitScenes(short.cues, SHORT_SCENES, short.seconds) : [];
    let shortPrompts: ScenePrompt[] = [];
    if (short) {
      try {
        const raw = await cached(path.join(shortDir, "scenes.json"), () => scenePrompts(m.characterLook, shortScenes.map((x) => x.text)));
        shortPrompts = raw.map((p) => ({ ...p, prompt: `${p.prompt}, vertical portrait composition` }));
        track.tick("agent", "short", `${SHORT_SCENES} prompt cảnh Short`);
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
    track.start("images", { long: n, ...(short ? { short: SHORT_SCENES } : {}) });
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
    const longVideo = await buildVideo({
      dir, name: "long", narration: long, prompts: longPrompts, scenes: longScenes,
      w: 1920, h: 1080, imgW: 1280, imgH: 768, fontSize: 62, marginV: 70,
      titleCard: `${s.title}\n\nChương ${c.number}: ${c.title}`,
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
          hook: m.thumbnailText, progressBar: true,
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
    const thumb = await thumbnail(dir, `${m.thumbnailPrompt}, ${m.characterLook}`, m.thumbnailText, c.number).catch(async (e) => {
      console.warn("⚠ Thumbnail AI lỗi, dùng ảnh đầu video:", e instanceof Error ? e.message : e);
      track.warn("images", "Thumbnail AI lỗi — dùng ảnh đầu video");
      await writeFile(path.join(dir, "thumb-src.jpg"), await readFile(path.join(dir, "long-img-0.jpg")));
      return thumbnail(dir, "", m.thumbnailText, c.number);
    });
    track.finish("images");
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
    const publishAt = onYoutube && v.publishAt ? v.publishAt : await keepOrNextSlot(v.publishAt);
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
    const status = e instanceof QuotaExhaustedError ? "queued" : "failed";
    await (status === "queued" ? track.pause(msg) : track.fail(msg));
    await db().update(videos).set({ status, error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(videos.id, videoId));
    if (status === "failed") {
      await notify(`❌ <b>Render lỗi</b> video #${videoId} — chương ${c.number}\n${escapeHtml(msg.slice(0, 300))}\n${runUrl ?? ""}\n👉 ${WEB_URL}/videos/${videoId}`);
    }
    throw e;
  }
}

// CLI: tsx pipeline/render.ts <videoId>
if (process.argv[1]?.endsWith("render.ts")) {
  renderVideo(Number(process.argv[2])).then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(e instanceof QuotaExhaustedError ? 0 : 1);
    },
  );
}
