import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { drawImage } from "./images";
import { duration, ffmpeg, filterPath, pool } from "./ffmpeg";
import { scenePrompts, videoMeta } from "./prompts";

type ScenePrompt = Awaited<ReturnType<typeof scenePrompts>>[number];
import { cuesForChunk, packChunks, sentences, toAss, type Cue } from "./text";
import { speak } from "./tts";

const run = promisify(execFile);
const FONT_DIR = path.resolve("pipeline/fonts");
const FONT = path.join(FONT_DIR, "BeVietnamPro-Bold.ttf");
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

/** Đọc toàn bộ văn bản thành 1 file WAV + cue phụ đề. */
async function narrate(text: string, dir: string, maxChars = 4000): Promise<Narration> {
  const chunks = packChunks(sentences(text), maxChars);
  const files = await pool(chunks, 3, async (chunk, i) => {
    const f = path.join(dir, `tts-${String(i).padStart(3, "0")}.wav`);
    await speak(chunk.join(" "), f);
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

const FADE = 0.8;
/** Pollinations không key có logo ở đáy ảnh → cắt 7%. Ảnh Cloudflare sạch, không cần. */
const LOGO_CROP = process.env.CLOUDFLARE_API_TOKEN ? "" : "crop=iw:ih*0.93:0:0,";
const SHOT_SECONDS = 10;
/** Cảnh hành động cắt nhanh, máy rung, zoom giật. */
const ACTION_SHOT_SECONDS = 3;
const ACTION_FADE = 0.3;
const MOTIONS = ["in", "left", "out", "right", "up", "in"] as const;
const ACTION_MOTIONS = ["punch", "shakeL", "punchOut", "shakeR"] as const;
type Motion = (typeof MOTIONS)[number] | (typeof ACTION_MOTIONS)[number];
const CALM_FX = ["fade", "dissolve", "smoothleft", "fade"];
const ACTION_FX = ["fadewhite", "zoomin", "slideleft", "radial", "fadewhite", "slideright"];

/** Biểu thức zoompan cho một kiểu máy quay; `e` là tiến độ có easing (chậm–nhanh–chậm). */
function motionExpr(m: Motion, frames: number) {
  const e = `(0.5-0.5*cos(PI*on/${frames}))`;
  // Thở nhẹ cho cảnh tĩnh; rung tay máy cho cảnh hành động (zoompan tự kẹp toạ độ trong ảnh).
  const sway = `3*sin(on/23)`;
  const shakeX = `(16*sin(on*2.1)+9*sin(on*4.7+1))`;
  const shakeY = `(11*sin(on*2.9+2)+6*sin(on*6.3))`;
  const cx = `iw/2-(iw/zoom/2)+${sway}`;
  const cy = "ih/2-(ih/zoom/2)";
  const ax = `iw/2-(iw/zoom/2)+${shakeX}`;
  const ay = `ih/2-(ih/zoom/2)+${shakeY}`;
  // Zoom giật nhanh rồi giữ: tiến độ dồn vào 1/3 đầu cảnh.
  const fast = `min(1,${e}*2.2)`;
  switch (m) {
    case "punch":
      return { z: `1.04+0.16*${fast}`, x: ax, y: ay };
    case "punchOut":
      return { z: `1.22-0.14*${fast}`, x: ax, y: ay };
    case "shakeL":
      return { z: "1.16", x: `(iw-iw/zoom)*${e}+${shakeX}`, y: ay };
    case "shakeR":
      return { z: "1.16", x: `(iw-iw/zoom)*(1-${e})+${shakeX}`, y: ay };
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
const ZOOM = 0.08;

/**
 * Ảnh → 1 cảnh có chuyển động máy quay. Phóng ảnh lên 2× khung ra (lanczos + làm nét) rồi mới zoompan:
 * zoompan làm tròn toạ độ theo pixel nguồn, nguồn 4K thì mỗi bước chỉ còn ½ pixel ở 1080p → hết rung.
 * Cắt 7% đáy để bỏ logo Pollinations.
 */
export async function shot(img: string, out: string, seconds: number, w: number, h: number, motion: Motion, action: boolean) {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const { z, x, y } = motionExpr(motion, frames);
  // Hành động: tương phản gắt hơn + chớp sáng 0.15s đầu cảnh như cú va chạm.
  const punch = action ? ",eq=contrast=1.12:saturation=1.2,fade=in:st=0:d=0.15:color=white" : "";
  await ffmpeg([
    "-loop", "1", "-i", img, "-t", seconds.toFixed(3),
    "-vf",
    `${LOGO_CROP}scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w * 2}:${h * 2}:(iw-ow)/2:(ih-oh)*0.3,unsharp=5:5:1.0,` +
      `zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${w}x${h}:fps=${FPS}${punch},format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-r", String(FPS), out,
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
  await ffmpeg([...inputs, "-filter_complex", graph.slice(0, -1), "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", out]);
}

async function buildVideo(opts: {
  dir: string; name: string; narration: Narration; prompts: ScenePrompt[]; scenes: { start: number; end: number }[];
  w: number; h: number; imgW: number; imgH: number; fontSize: number; marginV: number; titleCard?: string;
}) {
  const { dir, name, narration, prompts, scenes, w, h } = opts;
  // Mỗi ảnh (1 scene) tách thành nhiều cảnh ~10s với kiểu máy quay khác nhau.
  // Cảnh hành động cắt ~3s, mỗi nhát một kiểu zoom/rung và chuyển cảnh chớp trắng/zoom.
  const shots = scenes.flatMap((sc, i) => {
    const action = prompts[i].action;
    const n = Math.max(1, Math.round((sc.end - sc.start) / (action ? ACTION_SHOT_SECONDS : SHOT_SECONDS)));
    const len = (sc.end - sc.start) / n;
    return Array.from({ length: n }, (_, k) => ({
      image: i, seconds: len, action,
      motion: action ? ACTION_MOTIONS[(i + k) % ACTION_MOTIONS.length] : MOTIONS[(i * 2 + k) % MOTIONS.length],
      fade: action ? ACTION_FADE : FADE,
      fx: action ? ACTION_FX[(i + k) % ACTION_FX.length] : CALM_FX[(i + k) % CALM_FX.length],
    }));
  });
  const GROUP = 12;
  const files = await pool(shots, 4, async (sh, j) => {
    const img = path.join(dir, `${name}-img-${sh.image}.jpg`);
    await drawImage(prompts[sh.image].prompt, img, { width: opts.imgW, height: opts.imgH, seed: 1000 + sh.image * 7 });
    // Cảnh nào sẽ crossfade với cảnh sau thì kéo dài thêm FADE để tổng thời lượng vẫn khớp giọng đọc.
    const fadesNext = j % GROUP !== GROUP - 1 && j !== shots.length - 1;
    const seconds = sh.seconds + (fadesNext ? shots[j + 1].fade : 0);
    const file = path.join(dir, `${name}-shot-${String(j).padStart(3, "0")}.mp4`);
    await shot(img, file, seconds, w, h, sh.motion, sh.action);
    if (j % 10 === 0) console.log(`  ${name} cảnh ${j + 1}/${shots.length}`);
    return { file, seconds, fade: sh.fade, fx: sh.fx };
  });

  const groups: string[] = [];
  for (let g = 0; g * GROUP < files.length; g++) {
    const out = path.join(dir, `${name}-group-${g}.mp4`);
    await crossfadeGroup(files.slice(g * GROUP, (g + 1) * GROUP), out);
    groups.push(out);
  }
  const list = path.join(dir, `${name}-groups.txt`);
  await writeFile(list, groups.map((c) => `file '${c}'`).join("\n"));
  const silent = path.join(dir, `${name}-silent.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);

  const out = path.join(dir, `${name}.mp4`);
  const ass = path.join(dir, `${name}.ass`);
  await writeFile(ass, toAss(narration.cues, { width: w, height: h, fontSize: opts.fontSize, marginV: opts.marginV }));
  // Màu điện ảnh: tăng tương phản nhẹ, tối 4 góc, hạt phim.
  const grade = "eq=contrast=1.08:saturation=1.12:brightness=-0.02,vignette=PI/5,noise=alls=3:allf=t";
  const text = BURN_TEXT
    ? `,ass=${filterPath(ass)}:fontsdir=${filterPath(FONT_DIR)}` +
      (opts.titleCard
        ? `,drawtext=fontfile=${filterPath(FONT)}:text='${escText(opts.titleCard)}':fontsize=${Math.round(w / 22)}:fontcolor=white:borderw=5:bordercolor=black@0.8:x=(w-tw)/2:y=(h-th)/2:alpha='if(lt(t,0.6),t/0.6,if(lt(t,4),1,max(0,(5-t))))':enable='lt(t,5)'`
        : "")
    : "";
  const music = await pickMusic();
  const audio = music
    ? ["-stream_loop", "-1", "-i", music, "-filter_complex", "[2:a]volume=0.10[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]", "-map", "0:v", "-map", "[a]"]
    : ["-map", "0:v", "-map", "1:a"];
  await ffmpeg([
    "-i", silent, "-i", narration.audio, ...audio,
    "-vf", `${grade}${text},format=yuv420p`,
    // Hạt phim làm bitrate phình (12 phút ≈ 256MB) → chặn ~5Mbps, đủ nét cho YouTube 1080p.
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", "5M", "-bufsize", "10M",
    "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out,
  ]);
  return { out };
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

async function thumbnail(dir: string, prompt: string, text: string, chapterNo: number) {
  const img = path.join(dir, "thumb-src.jpg");
  await drawImage(prompt, img, { width: 1280, height: 768, seed: 42 });
  const out = path.join(dir, "thumbnail.jpg");
  const draw = BURN_TEXT
    ? `,drawtext=fontfile=${filterPath(FONT)}:text='${escText(text.toUpperCase())}':fontsize=96:fontcolor=#FFD23F:borderw=8:bordercolor=black:x=(w-tw)/2:y=h-th-70,` +
      `drawtext=fontfile=${filterPath(FONT)}:text='CHƯƠNG ${chapterNo}':fontsize=54:fontcolor=white:box=1:boxcolor=#B91C1C:boxborderw=18:x=40:y=40`
    : "";
  await ffmpeg(["-i", img, "-vf", `${LOGO_CROP}scale=1280:720:force_original_aspect_ratio=increase:flags=lanczos,crop=1280:720:(iw-ow)/2:(ih-oh)*0.3,unsharp=5:5:0.6${draw}`, "-q:v", "3", out]);
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

  // Giữ thư mục giữa các lần chạy (được cache trên Actions) để không tốn lại quota TTS/ảnh đã làm.
  const dir = path.resolve(`.render/video-${videoId}`);
  await mkdir(path.join(dir, "short"), { recursive: true });
  try {
    console.log(`▶ Video #${videoId}: ${s.title} — chương ${c.number}`);
    const m = await cached(path.join(dir, "meta.json"), () => videoMeta(s, c));
    const meta: VideoMeta = {
      title: m.title.length > 100 ? `${m.title.slice(0, 97)}…` : m.title,
      description: `${m.description}\n\n(Nội dung có sử dụng AI hỗ trợ giọng đọc và hình ảnh.)`,
      tags: m.tags,
      shortTitle: m.shortTitle,
      shortDescription: m.shortDescription,
    };

    console.log("● Video dài: đọc giọng");
    const intro = `${s.title}. Chương ${c.number}: ${c.title}.`;
    const long = await narrate(`${intro}\n${c.content}`, dir);
    // 1 ảnh ~20s (tách 2 cảnh ~10s). Free Pollinations 1 ảnh/45s nên giới hạn 45 ảnh.
    const n = Math.min(45, Math.max(6, Math.round(long.seconds / 20)));
    const longScenes = splitScenes(long.cues, n, long.seconds);
    const longPrompts = await cached(path.join(dir, `long-scenes-${n}.json`), () => scenePrompts(m.characterLook, longScenes.map((x) => x.text)));
    const longVideo = await buildVideo({
      dir, name: "long", narration: long, prompts: longPrompts, scenes: longScenes,
      w: 1920, h: 1080, imgW: 1280, imgH: 768, fontSize: 62, marginV: 70,
      titleCard: `${s.title}\n\nChương ${c.number}: ${c.title}`,
    });

    // Short và thumbnail là phụ: lỗi thì vẫn xuất video dài thay vì bỏ cả lần render.
    const extras: string[] = [];
    try {
      console.log("● Short");
      const shortDir = path.join(dir, "short");
      const short = await narrate(m.shortScript, shortDir);
      const shortScenes = splitScenes(short.cues, 5, short.seconds);
      const shortPrompts = await cached(path.join(shortDir, "scenes.json"), () => scenePrompts(m.characterLook, shortScenes.map((x) => x.text)));
      const shortVideo = await buildVideo({
        dir: shortDir, name: "short", narration: short, prompts: shortPrompts.map((p) => ({ ...p, prompt: `${p.prompt}, vertical portrait composition` })), scenes: shortScenes,
        w: 1080, h: 1920, imgW: 768, imgH: 1408, fontSize: 72, marginV: 520,
      });
      extras.push(shortVideo.out);
    } catch (e) {
      if (e instanceof QuotaExhaustedError) throw e;
      console.warn("⚠ Bỏ qua Short:", e instanceof Error ? e.message : e);
    }

    console.log("● Thumbnail");
    const thumb = await thumbnail(dir, `${m.thumbnailPrompt}, ${m.characterLook}`, m.thumbnailText, c.number).catch(async (e) => {
      console.warn("⚠ Thumbnail AI lỗi, dùng ảnh đầu video:", e instanceof Error ? e.message : e);
      await writeFile(path.join(dir, "thumb-src.jpg"), await readFile(path.join(dir, "long-img-0.jpg")));
      return thumbnail(dir, "", m.thumbnailText, c.number);
    });
    const metaFile = path.join(dir, "youtube.txt");
    await writeFile(metaFile, `${meta.title}\n\n${meta.description}\n\nTags: ${meta.tags.join(", ")}\n\n--- SHORT ---\n${meta.shortTitle}\n\n${meta.shortDescription}\n`);

    const assets = await publishRelease(videoId, [longVideo.out, ...extras, thumb, metaFile]);
    const publishAt = v.publishAt ?? (await nextPublishSlot());
    await db()
      .update(videos)
      .set({ status: "ready", meta, assets, durationSec: Math.round(long.seconds), publishAt, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    await notify(
      `🎬 <b>Video sẵn sàng đăng</b>\n${escapeHtml(meta.title)}\n` +
        `⏱ ${Math.round(long.seconds / 60)} phút${extras.length ? " + Short" : ""}\n` +
        `📅 Lên lịch: ${publishAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}\n` +
        `👉 ${WEB_URL}/videos`,
    );
    if (process.env.GITHUB_ACTIONS) await rm(dir, { recursive: true, force: true });
    console.log(`✔ Xong video #${videoId} (${Math.round(long.seconds / 60)} phút)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Hết quota thì trả về hàng đợi — job 3 tiếng/lần sẽ làm tiếp từ phần đã cache.
    const status = e instanceof QuotaExhaustedError ? "queued" : "failed";
    await db().update(videos).set({ status, error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(videos.id, videoId));
    if (status === "failed") {
      await notify(`❌ <b>Render lỗi</b> video #${videoId} — chương ${c.number}\n${escapeHtml(msg.slice(0, 300))}\n${runUrl ?? ""}\n👉 ${WEB_URL}/videos`);
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
