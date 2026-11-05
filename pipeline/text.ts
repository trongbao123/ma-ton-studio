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

/** Chia thời lượng một khối audio cho từng câu theo độ dài ký tự — TTS không trả timestamp. */
export function cuesForChunk(chunk: string[], offset: number, duration: number): Cue[] {
  const total = chunk.reduce((n, s) => n + s.length, 0) || 1;
  let t = offset;
  return chunk.flatMap((s) => {
    const d = (s.length / total) * duration;
    const parts = splitLong(s, 90);
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

/** Phụ đề ASS: chữ trắng viền đen, font Be Vietnam Pro (đủ dấu tiếng Việt). */
export function toAss(cues: Cue[], opts: { width: number; height: number; fontSize: number; marginV: number }) {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${opts.width}
PlayResY: ${opts.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Be Vietnam Pro,${opts.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,2,60,60,${opts.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  return header + cues.map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/\n/g, " ")}`).join("\n") + "\n";
}
