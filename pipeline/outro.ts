// Màn kết kêu gọi thích / chia sẻ / đăng ký, ghép vào CUỐI video tập: phần THUẦN (chỉ dựng tham số ffmpeg).
//
// Chừa hẳn cột phải cho thẻ End Screen THẬT của YouTube: thẻ bấm được (đăng ký, video tiếp) KHÔNG đặt được
// qua API — chỉ làm tay trong Studio — nên ở đây chỉ in chữ ở cột trái và để trống chỗ cho thẻ đè lên sau.
// Không vẽ ô placeholder: khi chưa đặt thẻ trong Studio, ô rỗng trông như lỗi dựng.
import { escText, filterPath } from "./ffmpeg";
import { AUDIO_BITRATE, AUDIO_RATE, STILL_FPS, STILL_TIMESCALE } from "./still";

/** Dài 15 giây: đủ cho YouTube nhận một mốc mục lục (< 10 giây là YouTube bỏ cả mục lục) và vừa khoảng thẻ End Screen (5–20 giây). */
export const OUTRO_SECONDS = 15;
/** Lề trái của chữ. */
export const OUTRO_MARGIN_X = 120;
/** Chữ không được tràn qua mốc này — phần bên phải để dành cho thẻ YouTube. */
export const OUTRO_TEXT_RIGHT = 1220;
/** Độ đậm lớp phủ đen trên nền (0–1): đủ để chữ đọc được trên ảnh sáng mà vẫn thấy hình. */
export const OUTRO_SCRIM = 0.45;

/** Chỗ đặt thẻ End Screen trong Studio (1920×1080): đặt theo toạ độ này thì thẻ không đè chữ. */
export const OUTRO_CARD_SLOTS: { kind: "video" | "subscribe"; x: number; y: number; w: number; h: number }[] = [
  { kind: "video", x: 1300, y: 250, w: 480, h: 270 },
  { kind: "subscribe", x: 1300, y: 580, w: 480, h: 270 },
];

export type OutroLine = { text: string; size: number; color: string; at: number };

/** Chữ màn kết — hiện lần lượt để mắt đọc kịp, không đổ ra một lúc. `publishHour` ví dụ "15h". */
export function outroLines(publishHour: string): OutroLine[] {
  return [
    { text: "ĐĂNG KÝ KÊNH", size: 104, color: "#FFD23F", at: 0.4 },
    { text: `nghe tập mới mỗi ngày lúc ${publishHour}`, size: 54, color: "white", at: 1.6 },
    { text: "THÍCH  ·  CHIA SẺ  ·  ĐĂNG KÝ", size: 46, color: "#FFD23F", at: 3.0 },
  ];
}

/** Dòng chữ hiện dần trong 0,5 giây rồi giữ, cùng mờ đi 0,8 giây trước khi hết màn kết. */
function lineAlpha(at: number, seconds: number) {
  const out = (seconds - 1.4).toFixed(2);
  return `alpha='if(lt(t,${at}),0,if(lt(t,${at + 0.5}),(t-${at})/0.5,if(lt(t,${out}),1,max(0,(${seconds - 0.6}-t)/0.8))))'`;
}

/**
 * Màn kết từ MỘT ảnh: nền phóng chậm + làm tối, chữ kêu gọi hiện dần ở cột trái, mờ ra đen ở cuối.
 * Xuất đúng thông số video chương tĩnh (24 fps, yuv420p, aac 192k 48 kHz stereo, timescale 12288)
 * để `concatLongs` ghép vào cuối tập bằng `-c copy`, không encode lại cả tập.
 */
export function outroArgs(o: {
  img: string;
  out: string;
  font: string;
  w: number;
  h: number;
  /** Nhạc nền (lặp rồi mờ dần); không có thì luồng tiếng im — vẫn phải có tiếng, không thì concat copy vỡ vì khác luồng. */
  music?: string | null;
  seconds?: number;
  fps?: number;
  logoCrop?: string;
  lines?: OutroLine[];
  /** Máy thiếu drawtext thì bỏ chữ, vẫn dựng được nền (xem BURN_TEXT trong render.ts). */
  burnText?: boolean;
  publishHour?: string;
}): string[] {
  const fps = o.fps ?? STILL_FPS;
  const seconds = o.seconds ?? OUTRO_SECONDS;
  const frames = Math.round(seconds * fps);
  const lines = o.lines ?? outroLines(o.publishHour ?? "15h");
  const text = (o.burnText ?? true)
    ? lines
        .map(
          (l, i) =>
            `,drawtext=fontfile=${filterPath(o.font)}:text='${escText(l.text)}':fontsize=${l.size}:fontcolor=${l.color}` +
            `:borderw=${Math.round(l.size / 12)}:bordercolor=black@0.85:x=${OUTRO_MARGIN_X}:y=${380 + i * 150}:${lineAlpha(l.at, seconds)}`,
        )
        .join("")
    : "";
  const video = [
    `[0:v]${o.logoCrop ?? ""}scale=${o.w * 2}:${o.h * 2}:force_original_aspect_ratio=increase:flags=bicubic`,
    `crop=${o.w * 2}:${o.h * 2}`,
    // Phóng 6% trong 15 giây — chậm đủ để không giật, đủ để màn kết không chết cứng.
    `zoompan=z='1+0.06*on/${frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=${frames}:s=${o.w}x${o.h}:fps=${fps}`,
    // Làm tối + giảm bão hoà, RỒI phủ một lớp đen lên cả khung.
    // Đo thật: chỉ hạ `eq` thôi thì chữ vàng trên nền vàng/sáng không đọc được; phủ 0,45 thì đọc được cả trên
    // nền bão hoà mạnh nhất mà ảnh vẫn còn nhìn ra hình (0,6 thì ảnh cảnh vốn đã tối bị dìm thành đen đặc).
    "eq=brightness=-0.10:saturation=0.8",
    `drawbox=x=0:y=0:w=iw:h=ih:color=black@${OUTRO_SCRIM}:t=fill`,
    "format=yuv420p",
  ].join(",");
  const tail = `fade=t=in:st=0:d=0.6,fade=t=out:st=${(seconds - 0.6).toFixed(2)}:d=0.6`;
  const audio = o.music
    ? `[1:a]aresample=${AUDIO_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.35,afade=t=in:st=0:d=1,afade=t=out:st=${(seconds - 3).toFixed(2)}:d=3[a]`
    : `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${seconds.toFixed(2)}[a]`;
  return [
    "-framerate", String(fps), "-i", o.img,
    ...(o.music ? ["-stream_loop", "-1", "-t", seconds.toFixed(2), "-i", o.music] : []),
    "-filter_complex", `${video}${text},${tail}[v];${audio}`,
    "-map", "[v]", "-map", "[a]", "-frames:v", String(frames),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", String(fps * 5), "-r", String(fps), "-video_track_timescale", STILL_TIMESCALE,
    "-c:a", "aac", "-b:a", AUDIO_BITRATE, "-ar", AUDIO_RATE, "-ac", "2",
    "-movflags", "+faststart", o.out,
  ];
}
