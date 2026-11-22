// Mở đầu kiểu trailer 30–45 giây: cắt nhanh các cảnh căng nhất của video, trống dồn, rồi mới vào kể.
// Chủ kênh: "mở truyện bánh cuốn vô" — 30 giây đầu quyết định người xem ở lại hay bỏ đi.
import path from "node:path";
import type { Shot } from "@/lib/story/storyboard";
import { ffmpeg } from "./ffmpeg";
import { drumBeats } from "./history-audio";

export const COLD_OPEN_SECONDS = { min: 30, max: 45 } as const;
/** Mỗi cảnh trong phần mở đầu chỉ 1,5–2,5 giây — nhịp trailer. */
export const COLD_OPEN_SHOT_MAX = 2.5;
const COLD_OPEN_SHOT_MIN = 1.5;

/** Thang độ căng của cảnh, cao nhất là cảnh có giao chiến. */
const TENSION_BATTLE = 3;
const TENSION_SOUND = 2;
const TENSION_MAP = 1;
const TENSION_NONE = 0;
const MS_PER_SECOND = 1000;

/** Cảnh càng căng càng được chọn trước: có giao chiến > có trống/tiếng hô > bản đồ hành quân > còn lại. */
function tension(shot: Shot): number {
  if (shot.battles?.length) return TENSION_BATTLE;
  if (shot.sfx.some((s) => s === "drum" || s === "shout" || s === "horn")) return TENSION_SOUND;
  if (shot.kind === "map" || shot.kind === "terrain") return TENSION_MAP;
  return TENSION_NONE;
}

/**
 * Chọn các cảnh căng nhất cho phần mở đầu, cắt mỗi cảnh còn 1,5–2,5 giây, giữ thứ tự thời gian
 * và nối liền nhau từ giây 0. `from`/`to` giữ nguyên để biết cảnh gốc.
 */
export function coldOpenShots(shots: Shot[]): Shot[] {
  const needed = Math.ceil(COLD_OPEN_SECONDS.min / COLD_OPEN_SHOT_MAX);
  const most = Math.floor(COLD_OPEN_SECONDS.max / COLD_OPEN_SHOT_MIN);
  const count = Math.min(shots.length, Math.max(needed, Math.min(most, shots.filter((s) => tension(s) >= TENSION_SOUND).length || needed)));
  const chosen = [...shots]
    .map((shot, order) => ({ shot, order }))
    .sort((a, b) => tension(b.shot) - tension(a.shot) || a.order - b.order)
    .slice(0, count)
    .sort((a, b) => a.order - b.order)
    .map((x) => x.shot);
  // Chia đều tổng thời lượng cho các cảnh đã chọn, trong khoảng cho phép mỗi cảnh.
  const each = Math.min(COLD_OPEN_SHOT_MAX, Math.max(COLD_OPEN_SHOT_MIN, COLD_OPEN_SECONDS.min / chosen.length));
  return chosen.map((shot, i) => ({ ...shot, start: i * each, end: (i + 1) * each }));
}

export type ColdOpenRender = {
  /** Cảnh mở đầu (đã cắt ngắn) kèm file video gốc của từng cảnh. */
  parts: { shot: Shot; file: string }[];
  dir: string;
  out: string;
};

/** Ghép phần mở đầu: cắt mỗi cảnh lấy đoạn giữa, nối cắt thẳng, chồng trống dồn. */
export async function renderColdOpen({ parts, dir, out }: ColdOpenRender) {
  const clips: string[] = [];
  for (const [i, part] of parts.entries()) {
    const seconds = part.shot.end - part.shot.start;
    const clip = path.join(dir, `open-${i}.mp4`);
    // Lấy đoạn giữa cảnh gốc (chỗ hình đã hiện rõ), bỏ phần mở đầu còn đang dựng.
    await ffmpeg(["-ss", "0.8", "-i", part.file, "-t", String(seconds), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", clip]);
    clips.push(clip);
  }
  const concatFile = path.join(dir, "open-list.txt");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(concatFile, clips.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  const silent = path.join(dir, "open-silent.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", silent]);
  const seconds = parts.reduce((n, p) => n + (p.shot.end - p.shot.start), 0);
  const beats = drumBeats(parts.map((p) => p.shot), seconds);
  const drumInputs = beats.flatMap(() => ["-f", "lavfi", "-i", "aevalsrc=exprs='0.9*sin(2*PI*58*t)*exp(-7*t)':d=1.6:sample_rate=48000"]);
  const labels = beats.map((at, i) => `[${i + 1}:a]adelay=${Math.round(at * MS_PER_SECOND)}|${Math.round(at * MS_PER_SECOND)},volume=1.4[d${i}]`);
  const graph = `${labels.join(";")};${beats.map((_, i) => `[d${i}]`).join("")}amix=inputs=${beats.length}:normalize=0,alimiter=limit=0.95[a]`;
  await ffmpeg(["-i", silent, ...drumInputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-t", String(seconds), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", out]);
}
