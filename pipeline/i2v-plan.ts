// Clip động (image-to-video trên GPU free của Kaggle): phần THUẦN — chọn cảnh, dựng manifest/metadata kernel, ghép clip + ảnh tĩnh.
// Không gọi mạng, không chạy ffmpeg; phần chạy thật nằm ở kaggle.ts / i2v.ts.
import { STILL_FADE_SECONDS, STILL_FPS, STILL_TIMESCALE } from "./still";

/** Mỗi chương làm 5–7 clip (tập 3 chương ≈ 15–20 clip). */
export const CLIPS_PER_CHAPTER = { min: 5, max: 7 } as const;
/** Trong số clip của chương, tối đa ngần này lấy từ 2 phút đầu (zoom) để mở đầu tập có chuyển động. */
const HEAD_CLIP_SHARE = 3;
/** Clip 121 khung (8k+1 theo yêu cầu LTX-Video) ở 24 fps ≈ 5,04 giây. */
// 97 frame ≈ 4s: khung đầu khóa cứng + khung cuối khóa nhẹ (CLIP_END_STRENGTH) giữ mặt; 73 frame + khóa cứng 2 đầu thì gần như đứng yên.
export const CLIP_FRAMES = 97;
/**
 * Độ khóa ảnh gốc ở khung cuối: 1 = đứng yên, 0 = không khóa.
 * 0,3 đo được từ `i2v-sweep` (Kaggle T4, LTX 2B distilled, ảnh cận mặt có hào quang):
 *   khóa 0,5 → YDIF 2,01 · SSIM 0,816   |   khóa 0,3 → YDIF 2,75 · SSIM 0,802   |   khóa 0 → YDIF 7,60 · SSIM 0,599
 * tức 0,3 cho thêm ~37% chuyển động mà gần như không trôi thêm.
 * ĐỪNG hạ về 0: YDIF cao lúc đó là đo sự TRÔI, không phải diễn xuất — ngay giữa clip model đã bỏ cảnh
 * (mất hào quang, mất mắt phát sáng, trời thành nắng nhạt), xem khung ở HANDOFF.
 */
export const CLIP_END_STRENGTH = 0.3;
export const CLIP_SECONDS = CLIP_FRAMES / STILL_FPS;
/** Kích thước LTX-Video phải chia hết cho 32; 768×448 gần 16:9 nhất — khi ghép sẽ scale/crop lên 1080p. */
export const CLIP_WIDTH = 768;
export const CLIP_HEIGHT = 448;
/** Thời gian mờ chéo từ clip sang ảnh tĩnh của chính ảnh đó (giây). */
export const CLIP_CROSSFADE_SECONDS = 1;
/** Cảnh ngắn hơn ngần này giây không đáng làm clip. */
const MIN_SCENE_SECONDS = 2;

export type SceneSpan = { start: number; end: number; zoom?: boolean; action?: boolean };

/** Chọn đều đặn `count` phần tử của `items` (luôn gồm phần tử đầu). */
function spread(items: number[], count: number): number[] {
  if (count >= items.length) return items;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, k) => items[Math.floor((k * items.length) / count)]);
}

/**
 * Chọn cảnh của một chương để làm clip động: vài ảnh 2 phút đầu (đều đặn, gồm ảnh đầu) + cảnh có cờ `action`,
 * bù thêm cảnh đều đặn nếu chưa đủ `min`. Trả chỉ số cảnh tăng dần, không quá `max`.
 */
export function pickClipScenes(scenes: SceneSpan[], limits: { min: number; max: number } = CLIPS_PER_CHAPTER): number[] {
  const usable = scenes.map((_, i) => i).filter((i) => scenes[i].end - scenes[i].start >= MIN_SCENE_SECONDS);
  const head = usable.filter((i) => scenes[i].zoom);
  const action = usable.filter((i) => scenes[i].action && !scenes[i].zoom);
  const chosen = new Set<number>(spread(head, Math.min(HEAD_CLIP_SHARE, limits.max)));
  for (const i of action) if (chosen.size < limits.max) chosen.add(i);
  if (chosen.size < limits.min) {
    const rest = usable.filter((i) => !chosen.has(i));
    for (const i of spread(rest, limits.min - chosen.size)) chosen.add(i);
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * Negative chung gửi kèm manifest (run.py chỉ dùng bản của mình khi manifest thiếu khoá này) — để chỗ duy nhất sửa là đây.
 * "changing pose" nằm đây là lý do nhân vật đứng im; ô `action` của i2v-sweep.ts bỏ đúng từ đó ra để thử.
 */
export const MOTION_NEGATIVE =
  "worst quality, inconsistent motion, blurry, jittery, distorted, morphing, deformed face, changing face, changing pose, new objects, extra people, photorealistic, live action, camera movement, zoom, shaky camera, static, frozen, still image, watermark, text";

/**
 * Một việc của kernel: ảnh trong dataset + prompt chuyển động tiếng Anh.
 * `endStrength` / `frames` / `negative` chỉ dùng khi dò tham số (i2v-sweep) — bỏ trống thì lấy mức chung của manifest.
 */
export type ClipJob = { id: number; image: string; prompt: string; endStrength?: number; frames?: number; negative?: string };

export type DatasetFile = { name: string; path: string };

/**
 * File gửi lên dataset Kaggle: manifest trước, rồi mỗi tên ảnh ĐÚNG MỘT LẦN.
 * Các ô dò tham số dùng chung một ảnh — gửi trùng thì Kaggle từ chối cả dataset ("Path must be unique").
 */
export function datasetFiles(manifest: DatasetFile, jobs: (ClipJob & { file: string })[]): DatasetFile[] {
  const byName = new Map<string, DatasetFile>();
  for (const j of jobs) if (!byName.has(j.image)) byName.set(j.image, { name: j.image, path: j.file });
  return [manifest, ...byName.values()];
}

/** Việc ghi vào manifest: bỏ đường dẫn máy local (kernel không thấy được), GIỮ mọi tham số ghi đè của ô dò. */
export function manifestJobs(jobs: (ClipJob & { file: string })[]): ClipJob[] {
  return jobs.map((j) => {
    const job = { ...j } as ClipJob & { file?: string };
    delete job.file;
    return job;
  });
}

/** Nội dung `manifest.json` trong dataset — run.py đọc đúng các khoá này. */
export function buildManifest(clips: ClipJob[], seed = 42) {
  return { width: CLIP_WIDTH, height: CLIP_HEIGHT, frames: CLIP_FRAMES, fps: STILL_FPS, seed, endStrength: CLIP_END_STRENGTH, negative: MOTION_NEGATIVE, clips };
}

/** Đuôi prompt chuyển động: chuyển động mượt, nhân vật không biến dạng, máy quay không rung. */
export const MOTION_SUFFIX = "dynamic epic xianxia visual effects, strong continuous motion, wind whipping hair and robes, glowing particles and sparks flying, static camera, the character keeps the same face and outfit, same 3D donghua art style";

export const motionPrompt = (motion: string) => `${motion.trim().replace(/[.\s]+$/, "")}, ${MOTION_SUFFIX}`;

/** Slug (a-z0-9-) hợp lệ cho dataset/kernel Kaggle. */
export const kaggleSlug = (kind: "data" | "run", videoId: number, stamp: number) => `mts-i2v-${kind}-${videoId}-${stamp.toString(36)}`;

/** Thân yêu cầu `POST /api/v1/kernels/push` (GPU + internet bật, script 1 file, dataset ảnh gắn vào). */
export function kernelPushBody(o: { username: string; slug: string; title: string; script: string; datasetSlug: string; timeoutSeconds: number }) {
  return {
    slug: `${o.username}/${o.slug}`,
    newTitle: o.title,
    text: o.script,
    language: "python",
    kernelType: "script",
    isPrivate: true,
    enableGpu: true,
    enableTpu: false,
    enableInternet: true,
    datasetDataSources: [`${o.username}/${o.datasetSlug}`],
    competitionDataSources: [] as string[],
    kernelDataSources: [] as string[],
    modelDataSources: [] as string[],
    categoryIds: [] as string[],
    sessionTimeoutSeconds: o.timeoutSeconds,
  };
}

/** Trạng thái kernel Kaggle gom về 4 nhóm. */
export type KernelPhase = "queued" | "running" | "done" | "failed";

export function kernelPhase(status: string): KernelPhase {
  const s = status.toLowerCase();
  if (s.includes("complete")) return "done";
  if (s.includes("error") || s.includes("cancel") || s.includes("fail")) return "failed";
  if (s.includes("running")) return "running";
  return "queued";
}

/** Dấu hiệu run.py in ra khi máy không GPU / không internet (tài khoản chưa xác minh điện thoại). */
export const NO_GPU_MARK = "MTS_NO_GPU";
export const NO_INTERNET_MARK = "MTS_NO_INTERNET";

export function kernelFailureKind(log: string): "no-gpu" | "no-internet" | "other" {
  if (log.includes(NO_GPU_MARK)) return "no-gpu";
  if (log.includes(NO_INTERNET_MARK)) return "no-internet";
  return "other";
}

export type ClipResult = { id: number; ok: boolean; seconds: number };

/** Dòng log `MTS_CLIP id=3 ok=1 sec=41.2` của run.py → kết quả từng clip. */
export function parseClipLog(log: string): ClipResult[] {
  return [...log.matchAll(/MTS_CLIP id=(\d+) ok=([01]) sec=([\d.]+)/g)].map((m) => ({ id: Number(m[1]), ok: m[2] === "1", seconds: Number(m[3]) }));
}

/** Giây GPU → phút làm tròn lên (≥ 1 nếu có chạy). */
export const gpuMinutes = (seconds: number) => (seconds > 0 ? Math.max(1, Math.ceil(seconds / 60)) : 0);

export type ClipSegmentSplit = { clipFrames: number; stillFrames: number; crossfadeFrames: number };

/**
 * Chia 1 đoạn `sceneFrames` khung: ảnh tĩnh trước, mờ chéo `crossfade` sang clip, clip (tối đa `clipFrames`) chạy tới hết đoạn.
 * Clip đặt CUỐI đoạn vì khung đầu clip ≈ ảnh gốc (nối liền), còn cuối clip trôi khỏi ảnh nhất thì bị mờ ra đen sang cảnh sau che.
 * Đoạn ngắn hơn/bằng clip thì chỉ phát clip (cắt), không có phần tĩnh. `stillFrames` đã gồm phần chồng mờ chéo.
 */
export function splitClipSegment(sceneFrames: number, clipFrames: number, fps = STILL_FPS, crossfade = CLIP_CROSSFADE_SECONDS): ClipSegmentSplit {
  if (sceneFrames <= clipFrames) return { clipFrames: sceneFrames, stillFrames: 0, crossfadeFrames: 0 };
  const xf = Math.min(Math.round(crossfade * fps), Math.floor(clipFrames / 2));
  return { clipFrames, stillFrames: sceneFrames - clipFrames + xf, crossfadeFrames: xf };
}

/**
 * Đoạn video 1080p có clip động: đoạn dài hơn clip thì ảnh tĩnh trước rồi mờ chéo sang clip (upscale lanczos) ở cuối đoạn;
 * mờ vào/ra như đoạn tĩnh. Cùng thông số h264/24fps/timescale với `stillSegmentArgs` để nối concat copy.
 */
export function clipSegmentArgs(o: { clip: string; img: string; out: string; frames: number; w: number; h: number; logoCrop?: string; fps?: number; clipFrames?: number }) {
  const fps = o.fps ?? STILL_FPS;
  const split = splitClipSegment(o.frames, o.clipFrames ?? CLIP_FRAMES, fps);
  const seconds = o.frames / fps;
  const fade = Math.min(STILL_FADE_SECONDS, seconds / 2);
  const fit = `scale=${o.w}:${o.h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${o.w}:${o.h},setsar=1,format=yuv420p`;
  const clipChain = `[0:v]fps=${fps},${fit},trim=end_frame=${split.clipFrames},setpts=PTS-STARTPTS`;
  const tail = `fade=t=in:st=0:d=${fade},fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`;
  const encode = [
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", String(fps * 5), "-r", String(fps),
    "-video_track_timescale", STILL_TIMESCALE, o.out,
  ];
  if (split.stillFrames === 0) {
    return ["-i", o.clip, "-filter_complex", `${clipChain},${tail}[v]`, "-map", "[v]", "-frames:v", String(o.frames), ...encode];
  }
  const xf = split.crossfadeFrames / fps;
  const offset = (split.stillFrames - split.crossfadeFrames) / fps;
  // Ảnh tĩnh cắt ĐÚNG khung clip (giữa ảnh, tỉ lệ CLIP_WIDTH:CLIP_HEIGHT như prepareClipImage) rồi phóng như clip → mờ chéo không xê dịch.
  const aspect = `crop='min(iw,ih*${CLIP_WIDTH}/${CLIP_HEIGHT})':'min(ih,iw*${CLIP_HEIGHT}/${CLIP_WIDTH})'`;
  const still = `[1:v]${o.logoCrop ?? ""}${aspect},${fit},fps=${fps},trim=end_frame=${split.stillFrames},setpts=PTS-STARTPTS`;
  const graph = `${clipChain}[c];${still}[s];[s][c]xfade=transition=fade:duration=${xf.toFixed(3)}:offset=${offset.toFixed(3)},${tail}[v]`;
  return [
    "-i", o.clip,
    "-loop", "1", "-framerate", String(fps), "-t", (split.stillFrames / fps + 1).toFixed(3), "-i", o.img,
    "-filter_complex", graph, "-map", "[v]", "-frames:v", String(o.frames), ...encode,
  ];
}
