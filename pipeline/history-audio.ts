// Âm thanh kênh lịch sử: nhạc sử thi đổi theo đoạn (bối cảnh → hành quân → giao chiến → kết), trống trận và
// tiếng hô ở cảnh đánh nhau, nhạc tự hạ khi có giọng. Trống/tiếng hô tổng hợp bằng ffmpeg — không vướng bản quyền.
import path from "node:path";
import type { Shot } from "@/lib/story/storyboard";

/**
 * Nhạc theo không khí từng đoạn — dùng lại kho nhạc Kevin MacLeod (CC BY 4.0) đã có trong repo,
 * xem `pipeline/music/README.txt`; mô tả video BẮT BUỘC ghi công.
 */
export const HISTORY_MUSIC_MOODS = {
  calm: ["Eastern Thought.mp3", "Ishikari Lore.mp3", "Long Note Two.mp3"],
  march: ["Asian Drums.mp3", "Rites.mp3", "Shamanistic.mp3"],
  battle: ["Lord of the Land.mp3", "Mystic Force.mp3", "Darkest Child.mp3"],
  elegy: ["Heartbreaking.mp3", "Long Note Two.mp3"],
} as const;

export type MusicMood = keyof typeof HISTORY_MUSIC_MOODS;
const MUSIC_DIR = path.resolve("pipeline/music");

/** Không khí của một cảnh; cảnh cuối video luôn là nhạc kết. */
export function moodOfShot(shot: Shot, isLast: boolean): MusicMood {
  if (isLast) return "elegy";
  if (shot.battles?.length) return "battle";
  if (shot.route?.length) return "march";
  if (shot.kind === "card" || shot.kind === "art") return "calm";
  return "march";
}

export type MusicSegment = { file: string; mood: MusicMood; start: number; end: number };

/** Chọn bài trong nhóm theo thứ tự đoạn, để một video không lặp đi lặp lại một bài. */
const pickTrack = (mood: MusicMood, index: number) => {
  const files = HISTORY_MUSIC_MOODS[mood];
  return path.join(MUSIC_DIR, files[index % files.length]);
};

/** Gộp các cảnh liền nhau cùng không khí thành một đoạn nhạc. */
export function musicPlan(shots: Shot[]): MusicSegment[] {
  const segments: MusicSegment[] = [];
  shots.forEach((shot, i) => {
    const mood = moodOfShot(shot, i === shots.length - 1);
    const previous = segments.at(-1);
    if (previous && previous.mood === mood) previous.end = shot.end;
    else segments.push({ file: pickTrack(mood, segments.length), mood, start: shot.start, end: shot.end });
  });
  return segments;
}

/** Trống dồn mở đầu video (nhanh dần). */
const OPENING_DRUMS = [0, 0.5, 0.9, 1.2, 1.42, 1.6];

/** Mốc giây đánh trống: dồn ở đầu video + một nhịp khi vào mỗi cảnh giao chiến. */
export function drumBeats(shots: Shot[], seconds: number): number[] {
  const battles = shots.filter((s) => s.battles?.length).map((s) => s.start);
  return [...OPENING_DRUMS, ...battles].filter((at) => at < seconds).sort((a, b) => a - b);
}

/** Mốc giây tiếng hô xung trận — chỉ cảnh đạo diễn đánh dấu `shout`. */
export function shoutBeats(shots: Shot[], seconds: number): number[] {
  return shots.filter((s) => s.sfx.includes("shout")).map((s) => s.start + 0.3).filter((at) => at < seconds);
}

/** Một nhịp trống: sine trầm tắt nhanh + ầm nâu (tổng hợp, không bản quyền). */
const DRUM_HIT_SECONDS = 1.6;
const drumSource = () =>
  `aevalsrc=exprs='0.9*sin(2*PI*58*t)*exp(-7*t)+0.35*sin(2*PI*96*t)*exp(-12*t)':d=${DRUM_HIT_SECONDS}:sample_rate=48000`;

/** Tiếng hô đám đông: nhiễu nâu lọc dải giọng + bao biên độ lên nhanh, tắt chậm (không thành lời — luật không hư cấu). */
const SHOUT_SECONDS = 2.4;
const shoutSource = (seed: number) =>
  `anoisesrc=c=brown:d=${SHOUT_SECONDS}:r=48000:a=0.8:s=${seed},highpass=f=180,lowpass=f=1400,` +
  `volume='min(1,t/0.25)*exp(-1.1*max(0,t-0.5))':eval=frame,tremolo=f=5.5:d=0.35`;

const MUSIC_FADE = 2;
const DRUM_GAIN = 1.3;
const SHOUT_GAIN = 0.75;
/** Nhạc hạ xuống khi có giọng (ducking). */
const DUCK_RATIO = 6;
const DUCK_THRESHOLD = 0.04;

export type HistoryAudioMix = { voice: string; video: string; shots: Shot[]; seconds: number; out: string };

/** Lệnh ffmpeg trộn giọng + nhạc theo đoạn + trống + tiếng hô vào video đã dựng hình. */
export function historyAudioArgs({ voice, video, shots, seconds, out }: HistoryAudioMix): string[] {
  const music = musicPlan(shots);
  const drums = drumBeats(shots, seconds);
  const shouts = shoutBeats(shots, seconds);
  const inputs = ["-i", video, "-i", voice];
  music.forEach((segment) => inputs.push("-stream_loop", "-1", "-i", segment.file));
  drums.forEach(() => inputs.push("-f", "lavfi", "-i", drumSource()));
  shouts.forEach((_, i) => inputs.push("-f", "lavfi", "-i", shoutSource(i + 1)));

  const musicFrom = 2;
  const drumFrom = musicFrom + music.length;
  const shoutFrom = drumFrom + drums.length;
  const delayMs = (at: number) => Math.round(at * 1000);
  const graph: string[] = [];
  graph.push(`[1:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[vo][duckkey]`);
  music.forEach((segment, i) => {
    const length = Math.max(0.5, segment.end - segment.start);
    graph.push(
      `[${musicFrom + i}:a]atrim=0:${length.toFixed(2)},asetpts=PTS-STARTPTS,` +
        `afade=t=in:d=${MUSIC_FADE},afade=t=out:st=${Math.max(0, length - MUSIC_FADE).toFixed(2)}:d=${MUSIC_FADE},` +
        `adelay=${delayMs(segment.start)}|${delayMs(segment.start)}[mu${i}]`,
    );
  });
  graph.push(`${music.map((_, i) => `[mu${i}]`).join("")}amix=inputs=${music.length}:normalize=0,volume=0.3[music]`);
  drums.forEach((at, i) => graph.push(`[${drumFrom + i}:a]adelay=${delayMs(at)}|${delayMs(at)},volume=${DRUM_GAIN}[dr${i}]`));
  shouts.forEach((at, i) => graph.push(`[${shoutFrom + i}:a]adelay=${delayMs(at)}|${delayMs(at)},volume=${SHOUT_GAIN}[sh${i}]`));
  const beats = [...drums.map((_, i) => `[dr${i}]`), ...shouts.map((_, i) => `[sh${i}]`)];
  const beatsLabel = beats.length ? "[beats]" : "";
  if (beats.length) graph.push(`${beats.join("")}amix=inputs=${beats.length}:normalize=0${beatsLabel}`);
  // Nhạc hạ xuống khi người dẫn nói, rồi lên lại.
  graph.push(`[music][duckkey]sidechaincompress=threshold=${DUCK_THRESHOLD}:ratio=${DUCK_RATIO}:attack=20:release=400[ducked]`);
  graph.push(`[vo][ducked]${beatsLabel}amix=inputs=${beats.length ? 3 : 2}:normalize=0,alimiter=limit=0.95,aformat=sample_rates=48000[a]`);

  return [
    ...inputs,
    "-filter_complex", graph.join(";"),
    "-map", "0:v", "-map", "[a]",
    "-t", String(seconds),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
    out,
  ];
}
