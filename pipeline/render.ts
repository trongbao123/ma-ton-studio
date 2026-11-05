import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type VideoMeta } from "@/db/schema";
import { drawImage } from "./images";
import { duration, ffmpeg, filterPath, pool } from "./ffmpeg";
import { scenePrompts, videoMeta } from "./prompts";
import { cuesForChunk, packChunks, sentences, toAss, type Cue } from "./text";
import { speak } from "./tts";

const run = promisify(execFile);
const FONT_DIR = path.resolve("pipeline/fonts");
const FONT = path.join(FONT_DIR, "BeVietnamPro-Bold.ttf");
/** Máy local thiếu libass/drawtext thì đặt BURN_TEXT=0 để test phần còn lại. */
const BURN_TEXT = process.env.BURN_TEXT !== "0";
const FPS = 24;

type Narration = { audio: string; cues: Cue[]; seconds: number };

/** Đọc toàn bộ văn bản thành 1 file WAV + cue phụ đề. */
async function narrate(text: string, style: string, dir: string, maxChars = 2800): Promise<Narration> {
  const chunks = packChunks(sentences(text), maxChars);
  const files = await pool(chunks, 3, async (chunk, i) => {
    const f = path.join(dir, `tts-${String(i).padStart(3, "0")}.wav`);
    await speak(chunk.join(" "), style, f);
    console.log(`  TTS ${i + 1}/${chunks.length}`);
    return f;
  });
  const cues: Cue[] = [];
  let t = 0;
  for (const [i, f] of files.entries()) {
    const d = await duration(f);
    cues.push(...cuesForChunk(chunks[i], t, d));
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

/** Ảnh tĩnh → clip có hiệu ứng zoom chậm (Ken Burns), cắt bỏ logo đáy ảnh Pollinations. */
async function kenBurns(img: string, out: string, seconds: number, w: number, h: number, zoomIn: boolean) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const z = zoomIn ? `min(1+0.12*on/${frames},1.12)` : `max(1.12-0.12*on/${frames},1)`;
  await ffmpeg([
    "-loop", "1", "-i", img, "-t", seconds.toFixed(3),
    "-vf",
    `crop=iw:ih*0.93:0:0,scale=${w * 1.25}:${h * 1.25}:force_original_aspect_ratio=increase,crop=${w * 1.25}:${h * 1.25},` +
      `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${w}x${h}:fps=${FPS},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-r", String(FPS), out,
  ]);
}

async function buildVideo(opts: {
  dir: string; name: string; narration: Narration; prompts: string[]; scenes: { start: number; end: number }[];
  w: number; h: number; imgW: number; imgH: number; fontSize: number; marginV: number;
}) {
  const { dir, name, narration, prompts, scenes, w, h } = opts;
  const clips = await pool(scenes, 4, async (sc, i) => {
    const img = path.join(dir, `${name}-img-${i}.jpg`);
    await drawImage(prompts[i], img, { width: opts.imgW, height: opts.imgH, seed: 1000 + i * 7 });
    const clip = path.join(dir, `${name}-clip-${String(i).padStart(3, "0")}.mp4`);
    await kenBurns(img, clip, sc.end - sc.start, w, h, i % 2 === 0);
    console.log(`  ${name} cảnh ${i + 1}/${scenes.length}`);
    return clip;
  });
  const list = path.join(dir, `${name}-clips.txt`);
  await writeFile(list, clips.map((c) => `file '${c}'`).join("\n"));
  const silent = path.join(dir, `${name}-silent.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);

  const out = path.join(dir, `${name}.mp4`);
  const ass = path.join(dir, `${name}.ass`);
  await writeFile(ass, toAss(narration.cues, { width: w, height: h, fontSize: opts.fontSize, marginV: opts.marginV }));
  const vf = BURN_TEXT ? ["-vf", `ass=${filterPath(ass)}:fontsdir=${filterPath(FONT_DIR)}`] : [];
  await ffmpeg([
    "-i", silent, "-i", narration.audio, ...vf,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out,
  ]);
  return { out, firstImage: path.join(dir, `${name}-img-0.jpg`) };
}

async function thumbnail(dir: string, prompt: string, text: string, chapterNo: number) {
  const img = path.join(dir, "thumb-src.jpg");
  await drawImage(prompt, img, { width: 1280, height: 768, seed: 42 });
  const out = path.join(dir, "thumbnail.jpg");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
  const draw = BURN_TEXT
    ? `,drawtext=fontfile=${filterPath(FONT)}:text='${esc(text.toUpperCase())}':fontsize=96:fontcolor=#FFD23F:borderw=8:bordercolor=black:x=(w-tw)/2:y=h-th-70,` +
      `drawtext=fontfile=${filterPath(FONT)}:text='CHƯƠNG ${chapterNo}':fontsize=54:fontcolor=white:box=1:boxcolor=#B91C1C:boxborderw=18:x=40:y=40`
    : "";
  await ffmpeg(["-i", img, "-vf", `crop=iw:ih*0.93:0:0,scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720${draw}`, "-q:v", "3", out]);
  return out;
}

async function publishRelease(videoId: number, files: string[]) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) {
    console.log("Không chạy trong GitHub Actions — bỏ qua upload release. File ở:", files);
    return {};
  }
  const tag = `video-${videoId}`;
  await run("gh", ["release", "delete", tag, "--repo", repo, "--yes", "--cleanup-tag"]).catch(() => {});
  await run("gh", ["release", "create", tag, ...files, "--repo", repo, "--title", tag, "--notes", "Ma Tôn Studio render"]);
  const { stdout } = await run("gh", ["api", `repos/${repo}/releases/tags/${tag}`, "--jq", "[.assets[] | {name, id}]"]);
  return Object.fromEntries((JSON.parse(stdout) as { name: string; id: number }[]).map((a) => [a.name, a.id]));
}

export async function renderVideo(videoId: number) {
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v) throw new Error(`Không có video #${videoId}`);
  const [c] = await db().select().from(chapters).where(eq(chapters.id, v.chapterId));
  const [s] = await db().select().from(series).where(eq(series.id, c.seriesId));
  const runUrl = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;
  await db().update(videos).set({ status: "rendering", error: null, runUrl, updatedAt: new Date() }).where(eq(videos.id, videoId));

  const dir = path.resolve(`.render/video-${videoId}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    console.log(`▶ Video #${videoId}: ${s.title} — chương ${c.number}`);
    const m = await videoMeta(s, c);
    const meta: VideoMeta = {
      title: m.title,
      description: `${m.description}\n\n(Nội dung có sử dụng AI hỗ trợ giọng đọc và hình ảnh.)`,
      tags: m.tags,
      shortTitle: m.shortTitle,
      shortDescription: m.shortDescription,
    };

    console.log("● Video dài: đọc giọng");
    const intro = `${s.title}. Chương ${c.number}: ${c.title}.`;
    const long = await narrate(`${intro}\n${c.content}`, s.voiceStyle, dir);
    const n = Math.min(40, Math.max(6, Math.round(long.seconds / 40)));
    const longScenes = splitScenes(long.cues, n, long.seconds);
    const longPrompts = await scenePrompts(m.characterLook, longScenes.map((x) => x.text));
    const longVideo = await buildVideo({
      dir, name: "long", narration: long, prompts: longPrompts, scenes: longScenes,
      w: 1280, h: 720, imgW: 1280, imgH: 768, fontSize: 44, marginV: 50,
    });

    console.log("● Short");
    const shortDir = path.join(dir, "short");
    await mkdir(shortDir);
    const short = await narrate(m.shortScript, s.voiceStyle, shortDir, 2000);
    const shortScenes = splitScenes(short.cues, 4, short.seconds);
    const shortPrompts = await scenePrompts(m.characterLook, shortScenes.map((x) => x.text));
    const shortVideo = await buildVideo({
      dir: shortDir, name: "short", narration: short, prompts: shortPrompts.map((p) => `${p}, vertical portrait composition`), scenes: shortScenes,
      w: 1080, h: 1920, imgW: 768, imgH: 1408, fontSize: 72, marginV: 520,
    });

    console.log("● Thumbnail");
    const thumb = await thumbnail(dir, `${m.thumbnailPrompt}, ${m.characterLook}`, m.thumbnailText, c.number);
    const metaFile = path.join(dir, "youtube.txt");
    await writeFile(metaFile, `${meta.title}\n\n${meta.description}\n\nTags: ${meta.tags.join(", ")}\n\n--- SHORT ---\n${meta.shortTitle}\n\n${meta.shortDescription}\n`);

    const assets = await publishRelease(videoId, [longVideo.out, shortVideo.out, thumb, metaFile]);
    await db()
      .update(videos)
      .set({ status: "ready", meta, assets, durationSec: Math.round(long.seconds), updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    console.log(`✔ Xong video #${videoId} (${Math.round(long.seconds / 60)} phút)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().update(videos).set({ status: "failed", error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(videos.id, videoId));
    throw e;
  }
}

// CLI: tsx pipeline/render.ts <videoId>
if (process.argv[1]?.endsWith("render.ts")) {
  renderVideo(Number(process.argv[2])).then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
