// Thumbnail kiểu "chữ nổ" theo bản chủ kênh làm tay 15/11/2026 (video #30 "THÁCH ĐẤU", vidIQ 98):
// mặt nhân vật cận cảnh nửa TRÁI, 2–3 từ IN HOA cực to ở nửa PHẢI, chữ cao hẹp nghiêng, tô vàng chanh → cam theo từng dòng,
// viền đen dày + bóng đổ đen. Không nhãn, không tên truyện, không số tập.
import { escText, filterPath } from "./ffmpeg";

export const BLAST_FONT = "pipeline/fonts/Anton-Regular.ttf";

/** Bề rộng tối đa khối chữ (px trên khung 1280) — nửa phải, chừa mặt nhân vật bên trái. */
const MAX_TEXT_W = 600;
/** Bề rộng trung bình 1 ký tự IN HOA của Anton (chữ cao hẹp), tính theo cỡ chữ. */
const CHAR_W = 0.5;
/** Lề phải của khối chữ. */
const RIGHT = 90;

/** Chia chữ thumbnail: ≤ 7 ký tự 1 dòng; còn lại chia 2 dòng đều nhau (3 dòng nếu > 18 ký tự). */
export function splitHookLines(text: string): string[] {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const total = words.join(" ").length;
  const n = Math.min(words.length, total <= 7 ? 1 : total <= 18 ? 2 : 3);
  if (n <= 1) return [words.join(" ")];
  const lines: string[] = [];
  let i = 0;
  for (let k = n; k > 0; k--) {
    const rest = words.slice(i);
    if (k === 1) {
      lines.push(rest.join(" "));
      break;
    }
    const target = rest.join(" ").length / k;
    let line = rest[0];
    let j = 1;
    // Thêm chữ khi dòng còn ngắn hơn mục tiêu và vẫn chừa đủ chữ cho các dòng sau.
    while (j < rest.length - (k - 1) && Math.abs(line.length + 1 + rest[j].length - target) <= Math.abs(line.length - target)) {
      line += ` ${rest[j]}`;
      j++;
    }
    lines.push(line);
    i += j;
  }
  return lines;
}

/** Cỡ chữ to nhất mà dòng dài nhất vẫn nằm trong MAX_TEXT_W; trần 240 (1–2 dòng) / 170 (3 dòng). */
export function blastFontSize(lines: string[]) {
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  const cap = lines.length <= 2 ? 240 : 170;
  return Math.round(Math.min(cap, MAX_TEXT_W / (longest * CHAR_W)));
}

/**
 * Bố cục chữ: `right` = 2–3 từ dựng đứng nửa phải (ảnh cận mặt, nhân vật bên trái);
 * `bottom` = chữ chạy ngang dải dưới (ảnh 2 nhân vật đối đầu chiếm 2/3 trên — chữ không che ai).
 */
export type BlastLayout = "right" | "bottom";

/** Dải dưới: ≤ 16 ký tự một dòng; dài hơn thì 2 dòng chia đôi theo số từ. */
export function bottomLines(text: string): string[] {
  const words = text.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const one = words.join(" ");
  if (one.length <= 16 || words.length < 2) return [one];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/**
 * Đoạn filter nối sau chuỗi -vf của ảnh nền 1280×720 (bắt đầu bằng dấu phẩy).
 * Mặt nạ chữ (trắng trên đen) → nghiêng (perspective) + xoay nhẹ → làm alpha cho 3 lớp: bóng đổ, viền đen, ruột chuyển màu.
 */
export function blastFilter(hook: string, layout: BlastLayout = "right", font = BLAST_FONT) {
  const bottom = layout === "bottom";
  const lines = bottom ? bottomLines(hook) : splitHookLines(hook);
  const longest = Math.max(1, ...lines.map((l) => [...l].length));
  const size = bottom ? Math.round(Math.min(lines.length === 1 ? 170 : 130, 1150 / (longest * CHAR_W))) : blastFontSize(lines);
  const lineH = Math.round(size * 1.1);
  const blockH = lineH * lines.length;
  const top = bottom ? Math.max(300, 700 - blockH) : Math.max(40, Math.round(350 - blockH / 2));
  const stroke = Math.max(8, Math.round(size / 10));
  const ff = filterPath(font);
  // Căn phải từng dòng (như "THÁCH" / "ĐẤU" lệch phải), dòng sau thụt vào trái một chút cho có nhịp.
  const text = (border: number) =>
    lines
      .map((l, i) => {
        const x = bottom ? "(w-tw)/2" : `w-tw-${RIGHT + (lines.length - 1 - i) * Math.round(size * 0.12)}`;
        return `drawtext=fontfile=${ff}:text='${escText(l)}':fontsize=${size}:fontcolor=white:borderw=${border}:bordercolor=white:x=${x}:y=${top + i * lineH}`;
      })
      .join(",");
  // Nghiêng chữ ~12° (đỉnh lệch phải) rồi xoay -5° — Anton vốn đứng nên tự tạo dáng nghiêng như nét cọ.
  const skew = Math.round(720 * 0.2);
  const tilt = `perspective=x0=${skew}:y0=0:x1=W+${skew}:y1=0:x2=0:y2=H:x3=W:y3=H:interpolation=linear:sense=destination,rotate=a=${bottom ? -3 : -5}*PI/180:c=black`;
  const blank = "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,format=gray";
  const solid = (c: string) => `drawbox=x=0:y=0:w=iw:h=ih:color=${c}:t=fill,format=rgb24`;
  // Ruột chữ: mỗi dòng vàng chanh ở đỉnh → cam ở chân; tính trong khung chưa nghiêng rồi nghiêng cùng mặt nạ.
  // Dòng của điểm ảnh = floor((Y - đỉnh - 0,3 cỡ chữ)/lineH) kẹp trong [0, n-1] — không dùng mod để chân chữ không bị quấn sang màu đỉnh.
  const row = `clip(floor((Y-${top}-${Math.round(size * 0.3)})/${lineH})\\,0\\,${lines.length - 1})`;
  const f = `clip((Y-${top}-${row}*${lineH}-${Math.round(size * 0.2)})/${Math.round(size * 0.9)}\\,0\\,1)`;
  const grad = `format=rgb24,geq=r=255:g='238-110*${f}':b='70-70*${f}',${tilt}`;
  // Nửa phải tối dần để chữ nổi trên nền rối.
  const shade = bottom
    ? `format=rgba,geq=r=8:g=4:b=16:a='190*clip((Y/H-0.5)/0.3\\,0\\,1)'`
    : `format=rgba,geq=r=8:g=4:b=16:a='170*clip((X/W-0.45)/0.3\\,0\\,1)'`;
  const parts = [
    `split=7[bg][sh][dm][sm][fm][sc][fc]`,
    `[sh]${shade}[shd]`,
    `[bg][shd]overlay=format=auto[b0]`,
    // Bóng đổ: mặt nạ viền dời xuống-phải rồi làm mờ.
    `[dm]${blank},${text(stroke * 2)},${tilt},boxblur=6:1,lut=c0=val*0.85,pad=iw+14:ih+14:14:14:black,crop=iw-14:ih-14:0:0[dmk]`,
    `[sm]${blank},${text(stroke)},${tilt}[smk]`,
    `[fm]${blank},${text(0)},${tilt}[fmk]`,
    `[sc]${solid("black")}[scol]`,
    `[fc]${grad}[fcol]`,
    `[scol]split[scol1][scol2]`,
    `[scol1][dmk]alphamerge[drop]`,
    `[scol2][smk]alphamerge[strk]`,
    `[fcol][fmk]alphamerge[fill]`,
    `[b0][drop]overlay=format=auto[b1]`,
    `[b1][strk]overlay=format=auto[b2]`,
    `[b2][fill]overlay=format=auto`,
  ];
  return `,${parts.join(";")}`;
}
