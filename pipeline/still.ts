// Chế độ dựng "tĩnh" cho video chương nội bộ của chế độ tập (phần thuần: chỉ dựng tham số ffmpeg, không chạy gì).
// Mỗi ảnh = 1 đoạn ảnh tĩnh, mờ vào/ra 0,5 giây; các đoạn nối bằng concat copy; âm thanh trộn 1 lần ở bước cuối, video copy nguyên.
// Lý do: hết zoompan/xfade/ass/re-encode toàn video → vừa ngân sách ~25 phút CPU cho 2 giờ video trên runner 2 vCPU.

import { parallaxFilterGraph, parallaxInputArgs, type ParallaxFiles, type ParallaxMotion } from "./parallax-plan";

export const STILL_FPS = 24;
/** Dip-to-black ở đầu và cuối mỗi đoạn. */
export const STILL_FADE_SECONDS = 0.5;
/** Đoạn zoom ngắn (~6 giây) nên mờ ngắn hơn để không nhấp nháy tối liên tục. */
const ZOOM_FADE_SECONDS = 0.25;
/** Phóng to tối đa trong 1 đoạn zoom (10%). */
const ZOOM_AMOUNT = 0.1;
const STILL_CRF = "23";
const STILL_PRESET = "veryfast";
/** Khung hình khoá mỗi 5 giây — đủ cho YouTube và cho tua. */
const STILL_GOP = String(STILL_FPS * 5);

/** Mức tiếng sau khi chuẩn hoá: giọng đọc -16 LUFS (chuẩn YouTube/podcast). */
export const VOICE_LUFS = -16;
/** Nhạc nền trước khi tự hạ: ≈ -10 dB; khi có giọng sidechain (ratio 3) hạ thêm ~5–7 dB → ≈ -17 dB dưới giọng — nghe rõ nhạc mà không lấn giọng (trước 0,18 + ratio 6 thì gần như chìm). */
export const MUSIC_GAIN = 0.3;
/** Nền "ma đạo" tự sinh vốn nhỏ hơn nhạc thật nên cho to hơn một chút. */
export const AMBIENT_GAIN = 0.45;
const MUSIC_FADE_IN = 3;
const MUSIC_FADE_OUT = 5;
export const AUDIO_BITRATE = "192k";
export const AUDIO_RATE = "48000";

/** Số khung hình của đoạn [start, end] giây: làm tròn theo MỐC cộng dồn nên tổng các đoạn không trôi so với giọng đọc. */
export function stillFrames(start: number, end: number, fps = STILL_FPS) {
  return Math.max(1, Math.round(end * fps) - Math.round(start * fps));
}

/** Parallax 2.5D của 1 đoạn: file mặt nạ (prepareParallax), kiểu máy quay và số khung có chuyển động (sau đó giữ nguyên khung cuối). */
export type StillParallax = { files: ParallaxFiles; motion: ParallaxMotion; motionFrames: number };

const fadeFilters = (fade: number, seconds: number) => [`fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`];

/** Mã hoá chung cho mọi đoạn: khác nhau duy nhất ở `-tune stillimage` (chỉ hợp khi hình đứng yên). */
const segmentEncodeArgs = (o: { out: string; fps: number; still: boolean }) => [
  "-c:v", "libx264", "-preset", STILL_PRESET, ...(o.still ? ["-tune", "stillimage"] : []), "-crf", STILL_CRF, "-g", STILL_GOP, "-r", String(o.fps),
  o.out,
];

/**
 * Ảnh → đoạn video tĩnh `frames` khung hình, 1920×1080 (scale/crop một lần), mờ vào/ra. `logoCrop` là chuỗi filter cắt logo (có dấu phẩy cuối) hoặc rỗng.
 * Có `parallax` thì dựng 3 lớp theo độ sâu trượt khác tốc độ (thay cho zoompan/ảnh tĩnh trong `parallax.motionFrames` khung đầu).
 */
export function stillSegmentArgs(o: { img: string; out: string; frames: number; w: number; h: number; logoCrop?: string; fps?: number; zoom?: boolean; parallax?: StillParallax }) {
  const fps = o.fps ?? STILL_FPS;
  const seconds = o.frames / fps;
  const fade = Math.min(o.zoom ? ZOOM_FADE_SECONDS : STILL_FADE_SECONDS, seconds / 2);
  if (o.parallax) {
    const graph = parallaxFilterGraph({ w: o.w, h: o.h, frames: o.frames, motionFrames: Math.min(o.frames, o.parallax.motionFrames), fps, motion: o.parallax.motion, logoCrop: o.logoCrop });
    return [
      "-i", o.img, ...parallaxInputArgs(o.parallax.files), "-frames:v", String(o.frames),
      "-filter_complex", `${graph};[v]${fadeFilters(fade, seconds).join(",")}[out]`, "-map", "[out]",
      ...segmentEncodeArgs({ out: o.out, fps, still: false }),
    ];
  }
  // `zoom`: 2 phút đầu của chương — zoom chậm vào giữa ảnh (zoompan, dựng từ ảnh nền 2× để không giật điểm ảnh); phần sau vẫn ảnh tĩnh.
  const motion = o.zoom
    ? [
        `scale=${o.w * 2}:${o.h * 2}:flags=bicubic`,
        `zoompan=z='1+${ZOOM_AMOUNT}*on/${o.frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${o.frames}:s=${o.w}x${o.h}:fps=${fps}`,
        "format=yuv420p",
      ]
    : ["format=yuv420p", "loop=loop=-1:size=1:start=0"];
  const vf = [
    `${o.logoCrop ?? ""}scale=${o.w}:${o.h}:force_original_aspect_ratio=increase:flags=bicubic`,
    `crop=${o.w}:${o.h}:(iw-ow)/2:(ih-oh)*0.3`,
    // Nhân khung đã scale/crop (1 khung) thay vì `-loop 1` bắt scale lại từng khung: đo local ≈ -18% thời gian đoạn, ra cùng file.
    ...motion,
    ...fadeFilters(fade, seconds),
  ].join(",");
  return [
    "-framerate", String(fps), "-i", o.img, "-frames:v", String(o.frames),
    "-vf", vf,
    ...segmentEncodeArgs({ out: o.out, fps, still: true }),
  ];
}

/** Timescale track video của đoạn tĩnh (ffmpeg mặc định cho 24 fps) — đoạn mở đầu phải trùng để concat copy không lệch mốc. */
export const STILL_TIMESCALE = "12288";

/**
 * Đưa 1 clip ngắn (vd đoạn mở đầu cao trào dựng bằng buildVideo, 30 fps, aac 44.1k, chưa chuẩn hoá tiếng)
 * về đúng thông số video chương tĩnh — 24 fps, yuv420p, aac 48k stereo, giọng ≈ -16 LUFS — để ghép vào tập bằng concat copy,
 * không phải encode lại cả tập dài.
 */
export function conformArgs(o: { input: string; out: string; w: number; h: number }) {
  return [
    "-i", o.input,
    "-vf", `scale=${o.w}:${o.h}:force_original_aspect_ratio=decrease,pad=${o.w}:${o.h}:(ow-iw)/2:(oh-ih)/2,fps=${STILL_FPS},format=yuv420p`,
    "-af", `loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11,aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`,
    "-c:v", "libx264", "-preset", STILL_PRESET, "-crf", STILL_CRF, "-g", STILL_GOP, "-r", String(STILL_FPS), "-video_track_timescale", STILL_TIMESCALE,
    "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", AUDIO_RATE, "-ac", "2",
    "-movflags", "+faststart", o.out,
  ];
}

/** Đọc "Integrated loudness" (LUFS) từ bản tóm tắt của filter ebur128 trong stderr ffmpeg; không đọc được (im lặng = -inf) thì null. */
export function parseIntegratedLufs(stderr: string) {
  const all = [...stderr.matchAll(/^\s*I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/gm)];
  const last = all.at(-1);
  return last ? Number(last[1]) : null;
}

const MAX_GAIN_DB = 30;
const MIN_GAIN_DB = -20;

/** Gain (dB) đưa giọng đã đo `measuredLufs` về -16 LUFS; không đo được thì null (rơi về loudnorm). Kẹp để file lỗi/gần im không bị khuếch đại vô lý. */
export function voiceGainDb(measuredLufs: number | null) {
  if (measuredLufs == null || !Number.isFinite(measuredLufs)) return null;
  return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, VOICE_LUFS - measuredLufs));
}

/**
 * Bộ lọc âm thanh: giọng về -16 LUFS; nhạc mờ vào/ra, tự hạ khi có giọng (sidechain); trộn rồi chặn đỉnh.
 * Có `voiceGain` (đã đo bằng ebur128, ~1 giây) thì chỉ nhân gain; không thì dùng loudnorm (đo local: 34 giây/40 phút giọng — đắt gấp 40 lần).
 */
export function episodeAudioGraph(o: { seconds: number; musicGain: number; voiceGain: number | null }) {
  const fadeOutAt = Math.max(0, o.seconds - MUSIC_FADE_OUT).toFixed(2);
  const level = o.voiceGain == null ? `loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11` : `volume=${o.voiceGain.toFixed(2)}dB`;
  return [
    `[1:a]${level},aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo][sc]`,
    `[2:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${o.musicGain},afade=t=in:st=0:d=${MUSIC_FADE_IN},afade=t=out:st=${fadeOutAt}:d=${MUSIC_FADE_OUT}[mu]`,
    "[mu][sc]sidechaincompress=threshold=0.04:ratio=3:attack=30:release=600:makeup=1[md]",
    "[vo][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.9[a]",
  ].join(";");
}

/** Bước cuối của chương tĩnh: nối các đoạn (concat copy) + trộn âm thanh trong MỘT lệnh, video `-c:v copy` (≈ 0 CPU video). */
export function episodeMuxArgs(o: { list: string; narration: string; music: string; seconds: number; isAmbient: boolean; voiceGain: number | null; out: string }) {
  return [
    "-f", "concat", "-safe", "0", "-i", o.list,
    "-i", o.narration,
    "-stream_loop", "-1", "-t", o.seconds.toFixed(2), "-i", o.music,
    "-filter_complex", episodeAudioGraph({ seconds: o.seconds, musicGain: o.isAmbient ? AMBIENT_GAIN : MUSIC_GAIN, voiceGain: o.voiceGain }),
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", AUDIO_RATE, "-ac", "2",
    "-shortest", "-movflags", "+faststart", o.out,
  ];
}
