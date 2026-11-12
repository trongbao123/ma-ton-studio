// Chế độ dựng "tĩnh" cho video chương nội bộ của chế độ tập (phần thuần: chỉ dựng tham số ffmpeg, không chạy gì).
// Mỗi ảnh = 1 đoạn ảnh tĩnh, mờ vào/ra 0,5 giây; các đoạn nối bằng concat copy; âm thanh trộn 1 lần ở bước cuối, video copy nguyên.
// Lý do: hết zoompan/xfade/ass/re-encode toàn video → vừa ngân sách ~25 phút CPU cho 2 giờ video trên runner 2 vCPU.

import { parallaxFilterGraph, parallaxInputArgs, type ParallaxFiles, type ParallaxMotion } from "./parallax-plan";
import { filterPath } from "./ffmpeg";

export const STILL_FPS = 24;
/** Dip-to-black ở đầu và cuối mỗi đoạn. */
// Cắt THẲNG giữa các cảnh như kênh top (Não Phẳng Tu Tiên: cắt thẳng, không mờ qua đen); mờ qua đen mỗi lần đổi ảnh = nhấp nháy tối.
export const STILL_FADE_SECONDS = 0;
/** Đoạn zoom ngắn (~6 giây) nên mờ ngắn hơn để không nhấp nháy tối liên tục. */
const ZOOM_FADE_SECONDS = 0;
/** Phóng to tối đa trong 1 đoạn zoom (10%). */
const ZOOM_AMOUNT = 0.1;
/**
 * Cảnh hành động — nhịp dựng kiểu phim, bù cho việc ảnh đứng yên:
 * chớp trắng ở cú cắt, đẩy ống kính vào mạnh hơn, rung khung rồi tắt dần.
 * Nhân vật không cử động được (đã đo: GPU free không làm nổi), nên cảm giác "đánh nhau" phải đến từ máy quay.
 */
const ACTION_ZOOM_AMOUNT = 0.22;
/** Chớp trắng dài bao lâu ở đầu cảnh. */
const ACTION_FLASH_SECONDS = 0.12;
/** Rung trong ngần này giây rồi hết hẳn (rung suốt cảnh thì chóng mặt, không phải điện ảnh). */
const ACTION_SHAKE_SECONDS = 0.55;
/** Biên độ rung tính theo điểm ảnh của khung 1080p. */
const ACTION_SHAKE_PX = 14;
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
/**
 * Tiếng hiệu ứng của clip động (sfx.ts): để nguyên mức đã cân ở sfx.ts (SFX_TRIM_DB đặt mỗi tiếng ở -21…-26 LUFS,
 * tức 5–10 dB dưới giọng đọc -16 LUFS) nên ở đây không hạ thêm.
 * KHÔNG sidechain theo giọng — hiệu ứng chỉ kêu 2–4 giây ở đúng mốc, hạ theo giọng thì mất hẳn tác dụng.
 * ĐỪNG nâng quá 1: đo bằng `pnpm exec tsx scripts/sfx-measure.mjs --mix`, từ 1,5 trở lên đỉnh thật của cả tập
 * vượt 0 dBFS (+1,6 dB ở 1,5; +2,4 dB ở 3) dù đã có alimiter=0.9 — hard limit sinh đỉnh giữa hai mẫu.
 */
export const SFX_GAIN = 1;
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

const fadeFilters = (fade: number, seconds: number) => (fade > 0 ? [`fade=t=in:st=0:d=${fade}`, `fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`] : []);

/** Bộ lọc đốt phụ đề ASS của riêng đoạn (mốc đã dời về 0) — đốt lúc dựng đoạn, bước nối vẫn copy video. */
export const subsFilter = (subs: string, fontsDir = "pipeline/fonts") => `ass=${filterPath(subs)}:fontsdir=${filterPath(fontsDir)}`;

/** Mã hoá chung cho mọi đoạn: khác nhau duy nhất ở `-tune stillimage` (chỉ hợp khi hình đứng yên). */
const segmentEncodeArgs = (o: { out: string; fps: number; still: boolean }) => [
  "-c:v", "libx264", "-preset", STILL_PRESET, ...(o.still ? ["-tune", "stillimage"] : []), "-crf", STILL_CRF, "-g", STILL_GOP, "-r", String(o.fps),
  o.out,
];

/**
 * Ảnh → đoạn video tĩnh `frames` khung hình, 1920×1080 (scale/crop một lần), mờ vào/ra. `logoCrop` là chuỗi filter cắt logo (có dấu phẩy cuối) hoặc rỗng.
 * Có `parallax` thì dựng 3 lớp theo độ sâu trượt khác tốc độ (thay cho zoompan/ảnh tĩnh trong `parallax.motionFrames` khung đầu).
 */
export function stillSegmentArgs(o: { img: string; out: string; frames: number; w: number; h: number; logoCrop?: string; fps?: number; zoom?: boolean; action?: boolean; parallax?: StillParallax; subs?: string; framing?: { x: number; y: number; w: number } }) {
  const fps = o.fps ?? STILL_FPS;
  const seconds = o.frames / fps;
  const fade = Math.min(o.zoom ? ZOOM_FADE_SECONDS : STILL_FADE_SECONDS, seconds / 2);
  if (o.parallax) {
    const graph = parallaxFilterGraph({ w: o.w, h: o.h, frames: o.frames, motionFrames: Math.min(o.frames, o.parallax.motionFrames), fps, motion: o.parallax.motion, logoCrop: o.logoCrop });
    return [
      "-i", o.img, ...parallaxInputArgs(o.parallax.files), "-frames:v", String(o.frames),
      "-filter_complex", `${graph};[v]${[...fadeFilters(fade, seconds), ...(o.subs ? [subsFilter(o.subs)] : [])].join(",") || "null"}[out]`, "-map", "[out]",
      ...segmentEncodeArgs({ out: o.out, fps, still: false }),
    ];
  }
  // `action`: cảnh đánh nhau — đẩy ống kính mạnh + rung tắt dần + chớp trắng ở cú cắt.
  // `zoom`: 2 phút đầu của chương — zoom chậm vào giữa ảnh (zoompan, dựng từ ảnh nền 2× để không giật điểm ảnh); phần sau vẫn ảnh tĩnh.
  const zoomAmount = o.action ? ACTION_ZOOM_AMOUNT : ZOOM_AMOUNT;
  // Cảnh hành động xuất khung RỘNG HƠN đích (dư ACTION_SHAKE_PX mỗi bên) để bước rung còn điểm ảnh thật mà dịch.
  // Đừng thay bằng pad: pad chèn viền ĐEN, rung đẩy khung sang là lộ vệt đen ở mép (đã dính một lần, xem khung mẫu).
  const outW = o.action ? o.w + ACTION_SHAKE_PX * 2 : o.w;
  const outH = o.action ? o.h + ACTION_SHAKE_PX * 2 : o.h;
  const motion =
    o.action || o.zoom
      ? [
          `scale=${o.w * 2}:${o.h * 2}:flags=bicubic`,
          `zoompan=z='1+${zoomAmount}*on/${o.frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${o.frames}:s=${outW}x${outH}:fps=${fps}`,
          "format=yuv420p",
        ]
      : ["format=yuv420p", "loop=loop=-1:size=1:start=0"];
  // Rung: cắt lệch tâm theo sin, biên độ tắt dần về 0 trong ACTION_SHAKE_SECONDS rồi đứng yên hẳn.
  const decay = `max(0,1-t/${ACTION_SHAKE_SECONDS})`;
  const shake = o.action
    ? [
        `crop=${o.w}:${o.h}:'${ACTION_SHAKE_PX}+if(lt(t,${ACTION_SHAKE_SECONDS}),${ACTION_SHAKE_PX}*${decay}*sin(t*47),0)':'${ACTION_SHAKE_PX}+if(lt(t,${ACTION_SHAKE_SECONDS}),${ACTION_SHAKE_PX}*${decay}*sin(t*61),0)'`,
      ]
    : [];
  const flash = o.action ? [`fade=t=in:st=0:d=${ACTION_FLASH_SECONDS}:color=white`] : [];
  // Góc máy ảo: cắt một vùng của ảnh (giữ tỉ lệ) trước khi phóng → cận cảnh/trung cảnh từ cùng một ảnh. Cận thì phóng lanczos cho đỡ mềm.
  const f = o.framing && o.framing.w < 1 ? o.framing : null;
  const vf = [
    `${o.logoCrop ?? ""}${f ? `crop=iw*${f.w}:ih*${f.w}:iw*${f.x}:ih*${f.y},` : ""}scale=${o.w}:${o.h}:force_original_aspect_ratio=increase:flags=${f ? "lanczos" : "bicubic"}`,
    `crop=${o.w}:${o.h}:(iw-ow)/2:(ih-oh)*0.3`,
    // Nhân khung đã scale/crop (1 khung) thay vì `-loop 1` bắt scale lại từng khung: đo local ≈ -18% thời gian đoạn, ra cùng file.
    ...motion,
    ...shake,
    // Cảnh hành động: chớp trắng thay cho mờ vào từ đen; vẫn mờ ra ở cuối để nối đoạn như cũ.
    ...(o.action ? [...flash, ...(fade > 0 ? [`fade=t=out:st=${(seconds - fade).toFixed(3)}:d=${fade}`] : [])] : fadeFilters(fade, seconds)),
    ...(o.subs ? [subsFilter(o.subs)] : []),
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
 * `sfx`: có input thứ 4 là track hiệu ứng của clip động (sfx.ts) — hạ xuống SFX_GAIN rồi trộn thẳng, không sidechain.
 */
export function episodeAudioGraph(o: { seconds: number; musicGain: number; voiceGain: number | null; sfx?: boolean }) {
  const fadeOutAt = Math.max(0, o.seconds - MUSIC_FADE_OUT).toFixed(2);
  const level = o.voiceGain == null ? `loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11` : `volume=${o.voiceGain.toFixed(2)}dB`;
  return [
    `[1:a]${level},aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,asplit=2[vo][sc]`,
    `[2:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${o.musicGain},afade=t=in:st=0:d=${MUSIC_FADE_IN},afade=t=out:st=${fadeOutAt}:d=${MUSIC_FADE_OUT}[mu]`,
    "[mu][sc]sidechaincompress=threshold=0.04:ratio=3:attack=30:release=600:makeup=1[md]",
    ...(o.sfx ? [`[3:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${SFX_GAIN}[sx]`] : []),
    `[vo][md]${o.sfx ? "[sx]" : ""}amix=inputs=${o.sfx ? 3 : 2}:duration=first:normalize=0,alimiter=limit=0.9[a]`,
  ].join(";");
}

/** Bước cuối của chương tĩnh: nối các đoạn (concat copy) + trộn âm thanh trong MỘT lệnh, video `-c:v copy` (≈ 0 CPU video). */
export function episodeMuxArgs(o: { list: string; narration: string; music: string; seconds: number; isAmbient: boolean; voiceGain: number | null; sfx?: string | null; out: string }) {
  return [
    "-f", "concat", "-safe", "0", "-i", o.list,
    "-i", o.narration,
    "-stream_loop", "-1", "-t", o.seconds.toFixed(2), "-i", o.music,
    ...(o.sfx ? ["-i", o.sfx] : []),
    "-filter_complex", episodeAudioGraph({ seconds: o.seconds, musicGain: o.isAmbient ? AMBIENT_GAIN : MUSIC_GAIN, voiceGain: o.voiceGain, sfx: Boolean(o.sfx) }),
    "-map", "0:v", "-map", "[a]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", AUDIO_RATE, "-ac", "2",
    "-shortest", "-movflags", "+faststart", o.out,
  ];
}
