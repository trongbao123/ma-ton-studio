// Cảnh thẻ chữ: nền giấy cũ sẫm + hạt, vệt cọ đỏ quét ngang, chữ hiện dần — dùng cho mốc thời gian,
// con số gây sốc, câu trích sử liệu (học thẻ năm "1904年2月" của video mẫu).
import path from "node:path";
import type { Shot } from "@/lib/story/storyboard";
import { ffmpeg } from "./ffmpeg";

export const CARD_W = 1920;
export const CARD_H = 1080;
export const CARD_FPS = 25;

const PAPER = "0x2b2116";
const BRUSH = "0x9e1b14";
const TITLE_COLOR = "0xf3e6c8";
const SUBTITLE_COLOR = "0xd8c7a3";
const TITLE_SIZE = 110;
const SUBTITLE_SIZE = 44;
const BRUSH_W = 900;
const BRUSH_H = 120;
/** Vệt cọ quét xong, chữ hiện, rồi dòng phụ hiện. */
const BRUSH_SWEEP_SECONDS = 0.7;
const TITLE_IN = 0.6;
const SUBTITLE_IN = 1.3;
const FADE_SECONDS = 0.6;

const FONT_SERIF = path.resolve("pipeline/fonts/PlayfairDisplay-Black.ttf");
const FONT_SANS = path.resolve("pipeline/fonts/BeVietnamPro-Bold.ttf");
const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");
/** Chữ trong drawtext: ffmpeg hiểu `:` là ngăn tham số, `\` là thoát, `'` là ngoặc. */
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");

/** Chuỗi filter dựng một thẻ chữ (tách riêng để test không cần chạy ffmpeg). */
export function cardFilterGraph(shot: Shot): string {
  const seconds = Math.max(0.5, shot.end - shot.start);
  const title = shot.title ?? "";
  const parts = [
    `color=c=${PAPER}:s=${CARD_W}x${CARD_H}:d=${seconds}:r=${CARD_FPS}`,
    "noise=alls=6:allf=t",
    `drawbox=x=(iw-${BRUSH_W})/2:y=ih/2-70:w='${BRUSH_W}*min(1,t/${BRUSH_SWEEP_SECONDS})':h=${BRUSH_H}:color=${BRUSH}@0.92:t=fill`,
    `drawtext=fontfile='${filterPath(FONT_SERIF)}':text='${escapeText(title)}':fontsize=${TITLE_SIZE}:fontcolor=${TITLE_COLOR}:x=(w-tw)/2:y=h/2-text_h/2-10:alpha='min(1,max(0,(t-${TITLE_IN})/${FADE_SECONDS}))'`,
  ];
  if (shot.subtitle) {
    parts.push(
      `drawtext=fontfile='${filterPath(FONT_SANS)}':text='${escapeText(shot.subtitle)}':fontsize=${SUBTITLE_SIZE}:fontcolor=${SUBTITLE_COLOR}:x=(w-tw)/2:y=h/2+90:alpha='min(1,max(0,(t-${SUBTITLE_IN})/${FADE_SECONDS}))'`,
    );
  }
  parts.push("vignette=PI/4.5", "format=yuv420p");
  return parts.join(",");
}

export type CardScene = { shot: Shot; out: string };

/** Dựng cảnh thẻ chữ ra mp4. */
export async function renderCardScene({ shot, out }: CardScene) {
  const seconds = Math.max(0.5, shot.end - shot.start);
  await ffmpeg(["-f", "lavfi", "-i", cardFilterGraph(shot), "-t", String(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out]);
}
