import { escText, filterPath } from "./ffmpeg";

/** Tách văn bản thành câu, giữ dấu câu. Dùng cho chia đoạn TTS và phụ đề. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((p) => p.match(/[^.!?…]+[.!?…]+["”’)]*|[^.!?…]+$/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Gom câu thành khối ≤ maxChars để mỗi lần gọi TTS không quá dài (model dài hay bỏ chữ). */
export function packChunks(list: string[], maxChars: number): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const s of list) {
    if (len + s.length > maxChars && cur.length) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(s);
    len += s.length + 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

export type Cue = { start: number; end: number; text: string };

/**
 * Chia thời lượng một khối audio cho từng câu theo độ dài ký tự — TTS không trả timestamp.
 * `maxChars`: độ dài tối đa mỗi dòng phụ đề (Short dọc cần ngắn hơn để không tràn nhiều dòng).
 */
export function cuesForChunk(chunk: string[], offset: number, duration: number, maxChars = 90, pauses: number[] = []): Cue[] {
  // Mốc hết câu: ước theo số ký tự, rồi kéo về khoảng lặng thật trong giọng đọc (nếu đo được) → phụ đề/cắt cảnh khớp giọng.
  const ends = alignSentenceEnds(chunk.map((s) => s.length), duration, pauses).map((e) => offset + e);
  let t = offset;
  return chunk.flatMap((s, si) => {
    const d = (si === chunk.length - 1 ? offset + duration : ends[si]) - t;
    const parts = splitLong(s, maxChars);
    const pl = parts.reduce((n, p) => n + p.length, 0) || 1;
    const cues = parts.map((p) => {
      const pd = (p.length / pl) * d;
      const cue = { start: t, end: t + pd, text: p };
      t += pd;
      return cue;
    });
    return cues;
  });
}

/**
 * Mốc HẾT từng câu (giây, tính từ đầu đoạn TTS): ước theo tỉ lệ ký tự rồi kéo về khoảng lặng gần nhất trong cửa sổ ±`window` giây
 * (giữ tăng dần, mỗi khoảng lặng dùng một lần). Không có khoảng lặng hợp lệ thì giữ mốc ước. Câu cuối luôn hết ở `duration`.
 * Thuần, để test.
 */
export function alignSentenceEnds(lengths: number[], duration: number, pauses: number[], window = 1.5): number[] {
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const out: number[] = [];
  let acc = 0;
  let prev = 0;
  let from = 0;
  for (let i = 0; i < lengths.length; i++) {
    acc += lengths[i];
    if (i === lengths.length - 1) {
      out.push(duration);
      break;
    }
    const est = (acc / total) * duration;
    let best = -1;
    for (let k = from; k < pauses.length; k++) {
      const p = pauses[k];
      if (p <= prev + 0.2) continue;
      if (p > est + window) break;
      if (Math.abs(p - est) <= window && (best < 0 || Math.abs(p - est) < Math.abs(pauses[best] - est))) best = k;
    }
    const end = best >= 0 ? pauses[best] : Math.max(est, prev + 0.2);
    if (best >= 0) from = best + 1;
    out.push(Math.min(end, duration));
    prev = out[out.length - 1];
  }
  return out;
}

/**
 * Dời mỗi ranh giới cảnh về mốc HẾT CÂU gần nhất (cue kết thúc bằng . ! ? …), tối đa 40% độ dài cảnh hai bên; giữ thứ tự,
 * cảnh tối thiểu 1 giây, giữ nguyên các trường khác (zoom…). Không có mốc hợp lệ thì giữ ranh giới cũ. Thuần, để test.
 */
export function snapToSentences<T extends { start: number; end: number }>(spans: T[], cues: Cue[], ratio = 0.4): T[] {
  const marks = cues.filter((c) => /[.!?…]["”'»)]*$/.test(c.text.trim())).map((c) => c.end);
  if (!marks.length || spans.length < 2) return spans;
  const out = spans.map((s) => ({ ...s }));
  for (let i = 0; i < out.length - 1; i++) {
    const b = out[i].end;
    const lo = Math.max(out[i].start + 1, b - (out[i].end - out[i].start) * ratio);
    const hi = Math.min(spans[i + 1].end - 1, b + (spans[i + 1].end - spans[i + 1].start) * ratio);
    let best = b;
    let dist = Infinity;
    for (const m of marks) {
      if (m >= lo && m <= hi && Math.abs(m - b) < dist) {
        best = m;
        dist = Math.abs(m - b);
      }
    }
    out[i].end = best;
    out[i + 1].start = best;
  }
  return out;
}

/** Giữa các khoảng lặng từ log `silencedetect` của ffmpeg (giây). */
export function parseSilenceMids(log: string): number[] {
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.flatMap((s, i) => (ends[i] != null ? [(s + ends[i]) / 2] : []));
}

/** Câu dài quá thì cắt theo dấu phẩy/khoảng trắng để phụ đề không tràn 2 dòng. */
function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const words = s.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += " " + w;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function assTime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = (sec % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${s}`;
}

/**
 * Karaoke: chữ đang đọc chuyển vàng theo giọng (thẻ \k của ASS, đơn vị 1/100 giây).
 * Thời lượng mỗi chữ chia theo độ dài chữ — giữ người xem dõi theo lời kể.
 */
export function karaoke(text: string, seconds: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const weight = words.reduce((n, w) => n + w.length + 1, 0) || 1;
  let used = 0;
  return words
    .map((w, i) => {
      const cs = i === words.length - 1 ? Math.max(1, Math.round(seconds * 100) - used) : Math.max(1, Math.round(((w.length + 1) / weight) * seconds * 100));
      used += cs;
      return `{\\k${cs}}${w}`;
    })
    .join(" ");
}

/**
 * Phụ đề ASS: chữ trắng viền đen dày + bóng, font Be Vietnam Pro (đủ dấu tiếng Việt).
 * Có `karaoke` thì chữ đang đọc sáng vàng thếp (#FFD23F — cùng màu chữ thumbnail).
 */
/**
 * Câu của riêng một đoạn [start, end) (giây trên dòng thời gian chương), mốc dời về đầu đoạn và cắt gọn trong đoạn —
 * để đốt phụ đề lúc dựng từng đoạn. Thuần, để test.
 */
export function cuesForSegment(cues: Cue[], start: number, end: number): Cue[] {
  return cues
    .filter((c) => c.end > start + 0.05 && c.start < end - 0.05)
    .map((c) => ({ start: Math.max(0, c.start - start), end: Math.min(end, c.end) - start, text: c.text }));
}

export function toAss(cues: Cue[], opts: { width: number; height: number; fontSize: number; marginV: number; karaoke?: boolean }) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Be Vietnam Pro,${opts.fontSize},${opts.karaoke ? "&H003FD2FF" : "&H00FFFFFF"},&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,5,2,2,70,70,${opts.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return (
    header +
    cues
      .map((c) => {
        const text = c.text.replace(/\n/g, " ");
        return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${opts.karaoke ? karaoke(text, c.end - c.start) : text}`;
      })
      .join("\n") +
    "\n"
  );
}

/** Cỡ chữ thẻ tên truyện: co theo dòng dài nhất để không tràn mép, không nhỏ quá 24. */
export function titleCardFontSize(text: string, w: number) {
  const longest = Math.max(1, ...text.split("\n").map((l) => [...l].length));
  return Math.max(24, Math.min(Math.round(w / 22), Math.floor((w * 0.9) / (longest * 0.6))));
}

/**
 * Thẻ tên truyện / số tập: hiện dần rồi tắt hẳn trong khoảng [start, start+seconds].
 * `enable` kẹp đúng khoảng của thẻ — đặt ở CUỐI intro thì không được dính sang chương sau.
 */
export function titleCardFilter(o: { text: string; w: number; font: string; start: number; seconds?: number }) {
  const d = o.seconds ?? 5;
  const end = o.start + d;
  const t = `(t-${o.start})`;
  const alpha = `if(lt(${t},0.6),${t}/0.6,if(lt(${t},${d - 1}),1,max(0,(${d}-${t}))))`;
  return (
    `,drawtext=fontfile=${filterPath(o.font)}:text='${escText(o.text)}':fontsize=${titleCardFontSize(o.text, o.w)}:fontcolor=white:borderw=5:bordercolor=black@0.8` +
    `:x=(w-tw)/2:y=(h-th)/2:alpha='${alpha}':enable='between(t,${o.start},${end})'`
  );
}
