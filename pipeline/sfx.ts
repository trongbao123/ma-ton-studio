// Âm thanh hiệu ứng cho clip động, tổng hợp bằng ffmpeg lavfi: không GPU, không bản quyền, không tải mẫu tiếng về.
// Phần THUẦN (chỉ dựng tham số ffmpeg); render.ts dựng sfx.wav rồi still.ts trộn vào tập (input thứ 4).
import { CLIP_FRAMES, splitClipSegment } from "./i2v-plan";
import { STILL_FPS, stillFrames } from "./still";

export type SfxKind = "thunder" | "boom" | "energy" | "whoosh" | "rumble";

/** Thứ tự ưu tiên khi prompt khớp nhiều loại (lấy tối đa 2). */
const RULES: [SfxKind, RegExp][] = [
  ["thunder", /lightning|thunder|storm/i],
  ["boom", /erupt|burst|explo|shockwave|blast|boom|impact|debris|shatter/i],
  ["energy", /aura|qi\b|energy|glow|spiritual|pulse|rune/i],
  ["whoosh", /wind|whip|billow|robe|hair|swirl/i],
  ["rumble", /fire|flame|roar|earth|quake/i],
];

export const SFX_KINDS: SfxKind[] = RULES.map(([k]) => k);

/** Loại tiếng theo prompt chuyển động của clip (tối đa 2; không khớp gì thì "whoosh"). */
export function sfxKinds(motion: string): SfxKind[] {
  const hit = RULES.filter(([, re]) => re.test(motion)).map(([k]) => k);
  return (hit.length ? hit : (["whoosh"] as SfxKind[])).slice(0, 2);
}

export const SFX_SECONDS: Record<SfxKind, number> = { thunder: 3, boom: 2.5, energy: 3, whoosh: 1.8, rumble: 4 };

/** Lệch so với lúc clip hiện rõ: nổ/sấm trễ một nhịp cho khớp đỉnh hiệu ứng, tiếng nền vào sớm. */
const LEAD: Record<SfxKind, number> = { thunder: 0.5, boom: 0.5, energy: -0.3, whoosh: -0.2, rumble: -0.5 };

export type SfxEvent = { kind: SfxKind; at: number };

/**
 * Mốc tiếng trên dòng thời gian chương. Chỉ cảnh có clip THẬT (`file` đã tải về) mới kêu — clip lỗi vẫn là ảnh tĩnh, không có gì để kêu.
 * Clip nằm CUỐI đoạn cảnh (splitClipSegment) nên mốc lấy ở giữa lúc mờ chéo vào clip; bỏ mốc rơi ra ngoài `seconds` của chương.
 */
export function sfxEvents(
  clips: readonly { scene: number; motion: string; file?: string }[],
  scenes: readonly { start: number; end: number }[],
  seconds: number,
  fps = STILL_FPS,
): SfxEvent[] {
  const out: SfxEvent[] = [];
  for (const c of clips) {
    const sc = scenes[c.scene];
    if (!sc || !c.file) continue;
    const split = splitClipSegment(stillFrames(sc.start, sc.end, fps), CLIP_FRAMES, fps);
    const segStart = Math.round(sc.start * fps) / fps;
    const visible = segStart + (split.stillFrames ? (split.stillFrames - split.crossfadeFrames / 2) / fps : 0);
    for (const kind of sfxKinds(c.motion)) {
      const at = Math.max(0, visible + LEAD[kind]);
      if (at < seconds) out.push({ kind, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * Mức bù (dB) cân độ to CẢM NHẬN giữa các loại: đo integrated LUFS của từng tiếng bằng ebur128 (`node scripts/sfx-measure.mjs`),
 * rồi bù về mốc thiết kế — nổ/sấm là điểm nhấn (-20/-21 LUFS), nền ì ầm thấp hơn (-24), gió và hào quang chỉ là lớp đệm (-26).
 * Đo lại SAU khi bù (ffmpeg 9.0.2): thunder -21,3 · boom -20,0 · energy -26,0 · whoosh -25,9 · rumble -23,6 LUFS, đỉnh cao nhất -2,0 dBFS.
 */
export const SFX_TRIM_DB: Record<SfxKind, number> = { thunder: 1.5, boom: 7.9, energy: 4.2, whoosh: -1.5, rumble: -1 };

/**
 * Bộ lọc lavfi tạo 1 tiếng (48 kHz, mono), đã cân mức theo SFX_TRIM_DB.
 * `variant` đổi seed nhiễu: 2 tiếng cùng loại trong một chương nghe khác nhau, nhưng dựng lại vẫn ra đúng file cũ (đo mức lặp lại được).
 */
export function sfxSource(kind: SfxKind, variant = 0): string {
  const base = 1000 + SFX_KINDS.indexOf(kind) * 1000 + variant * 10;
  return `${sourceChain(kind, (n) => base + n)},volume=${SFX_TRIM_DB[kind]}dB`;
}

function sourceChain(kind: SfxKind, s: (n: number) => number): string {
  const d = SFX_SECONDS[kind];
  switch (kind) {
    case "boom":
      return `sine=f=48:d=${d}:r=48000,volume=0.9[b0];anoisesrc=c=brown:d=${d}:r=48000:a=0.9:s=${s(1)},lowpass=f=180,lowpass=f=180[b1];[b0][b1]amix=inputs=2:normalize=0,afade=t=in:d=0.015,afade=t=out:st=0.08:d=${d - 0.08}:curve=exp`;
    case "thunder":
      return `anoisesrc=c=white:d=0.3:r=48000:a=0.6:s=${s(1)},highpass=f=1800,afade=t=out:d=0.3:curve=exp,apad=whole_dur=${d}[t0];anoisesrc=c=brown:d=${d}:r=48000:a=1:s=${s(2)},lowpass=f=320,tremolo=f=6:d=0.5,afade=t=in:d=0.05,afade=t=out:st=0.4:d=${d - 0.4}:curve=exp[t1];[t0][t1]amix=inputs=2:normalize=0`;
    case "energy":
      return `sine=f=110:d=${d}:r=48000,tremolo=f=9:d=0.7,volume=0.35[e0];sine=f=165:d=${d}:r=48000,tremolo=f=5:d=0.5,volume=0.2[e1];anoisesrc=c=pink:d=${d}:r=48000:a=0.25:s=${s(1)},highpass=f=5000[e2];[e0][e1][e2]amix=inputs=3:normalize=0,afade=t=in:d=0.6:curve=qsin,afade=t=out:st=${d - 1.2}:d=1.2`;
    case "whoosh":
      return `anoisesrc=c=pink:d=${d}:r=48000:a=0.8:s=${s(1)},highpass=f=350,lowpass=f=2600,afade=t=in:d=${d * 0.55}:curve=qsin,afade=t=out:st=${d * 0.55}:d=${d * 0.45}:curve=qsin`;
    case "rumble":
      return `anoisesrc=c=brown:d=${d}:r=48000:a=1:s=${s(1)},lowpass=f=110,lowpass=f=110,volume=1.4,afade=t=in:d=0.8,afade=t=out:st=${d - 1.5}:d=1.5`;
  }
}

/** Lệnh ffmpeg dựng track hiệu ứng dài `seconds` (stereo 48 kHz): mỗi tiếng đặt đúng mốc bằng adelay. Không có tiếng nào thì ra track im lặng. */
export function sfxTrackArgs(events: SfxEvent[], seconds: number, out: string): string[] {
  const stereo = "aformat=channel_layouts=stereo[a]";
  const silence = `anullsrc=r=48000:cl=mono,atrim=duration=${seconds.toFixed(2)}`;
  const tail = ["-map", "[a]", "-c:a", "pcm_s16le", out];
  if (!events.length) return ["-filter_complex", `${silence},${stereo}`, ...tail];
  const parts = events.map((e, i) => {
    // Nhãn trung gian của nguồn ([b0], [t1]…) phải khác nhau giữa các tiếng, kể cả 2 tiếng cùng loại.
    const src = sfxSource(e.kind, i).replace(/\[([a-z]\d)\]/g, `[$1_${i}]`);
    return `${src},adelay=${Math.round(e.at * 1000)}:all=1[x${i}]`;
  });
  const mix = `[base]${events.map((_, i) => `[x${i}]`).join("")}amix=inputs=${events.length + 1}:duration=first:normalize=0,alimiter=limit=0.95,${stereo}`;
  return ["-filter_complex", [`${silence}[base]`, ...parts, mix].join(";"), ...tail];
}
