// WIP (chưa nối vào render, chưa test) — âm thanh hiệu ứng cho clip động, tổng hợp bằng ffmpeg lavfi: không GPU, không bản quyền.
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

/** Loại tiếng theo prompt chuyển động của clip (tối đa 2; không khớp gì thì "whoosh"). */
export function sfxKinds(motion: string): SfxKind[] {
  const hit = RULES.filter(([, re]) => re.test(motion)).map(([k]) => k);
  return (hit.length ? hit : (["whoosh"] as SfxKind[])).slice(0, 2);
}

export const SFX_SECONDS: Record<SfxKind, number> = { thunder: 3, boom: 2.5, energy: 3, whoosh: 1.8, rumble: 4 };

/** Lệch so với lúc clip hiện rõ: nổ/sấm trễ một nhịp cho khớp đỉnh hiệu ứng, tiếng nền vào sớm. */
const LEAD: Record<SfxKind, number> = { thunder: 0.5, boom: 0.5, energy: -0.3, whoosh: -0.2, rumble: -0.5 };

export type SfxEvent = { kind: SfxKind; at: number };

/** Mốc tiếng trên dòng thời gian chương: clip nằm CUỐI đoạn cảnh (splitClipSegment), lấy giữa lúc mờ chéo vào clip. */
export function sfxEvents(clips: { scene: number; motion: string }[], scenes: { start: number; end: number }[], fps = STILL_FPS): SfxEvent[] {
  const out: SfxEvent[] = [];
  for (const c of clips) {
    const sc = scenes[c.scene];
    if (!sc) continue;
    const split = splitClipSegment(stillFrames(sc.start, sc.end, fps), CLIP_FRAMES, fps);
    const segStart = Math.round(sc.start * fps) / fps;
    const visible = segStart + (split.stillFrames ? (split.stillFrames - split.crossfadeFrames / 2) / fps : 0);
    for (const kind of sfxKinds(c.motion)) out.push({ kind, at: Math.max(0, visible + LEAD[kind]) });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Bộ lọc lavfi tạo 1 tiếng (48 kHz). Biên độ CHƯA cân bằng tai nghe — cần nghe thử. */
export function sfxSource(kind: SfxKind): string {
  const d = SFX_SECONDS[kind];
  switch (kind) {
    case "boom":
      return `sine=f=48:d=${d}:r=48000,volume=0.9[b0];anoisesrc=c=brown:d=${d}:r=48000:a=0.9,lowpass=f=180,lowpass=f=180[b1];[b0][b1]amix=inputs=2:normalize=0,afade=t=in:d=0.015,afade=t=out:st=0.08:d=${d - 0.08}:curve=exp`;
    case "thunder":
      return `anoisesrc=c=white:d=0.3:r=48000:a=0.6,highpass=f=1800,afade=t=out:d=0.3:curve=exp,apad=whole_dur=${d}[t0];anoisesrc=c=brown:d=${d}:r=48000:a=1,lowpass=f=320,tremolo=f=6:d=0.5,afade=t=in:d=0.05,afade=t=out:st=0.4:d=${d - 0.4}:curve=exp[t1];[t0][t1]amix=inputs=2:normalize=0`;
    case "energy":
      return `sine=f=110:d=${d}:r=48000,tremolo=f=9:d=0.7,volume=0.35[e0];sine=f=165:d=${d}:r=48000,tremolo=f=5:d=0.5,volume=0.2[e1];anoisesrc=c=pink:d=${d}:r=48000:a=0.25,highpass=f=5000[e2];[e0][e1][e2]amix=inputs=3:normalize=0,afade=t=in:d=0.6:curve=qsin,afade=t=out:st=${d - 1.2}:d=1.2`;
    case "whoosh":
      return `anoisesrc=c=pink:d=${d}:r=48000:a=0.8,highpass=f=350,lowpass=f=2600,afade=t=in:d=${d * 0.55}:curve=qsin,afade=t=out:st=${d * 0.55}:d=${d * 0.45}:curve=qsin`;
    case "rumble":
      return `anoisesrc=c=brown:d=${d}:r=48000:a=1,lowpass=f=110,lowpass=f=110,volume=1.4,afade=t=in:d=0.8,afade=t=out:st=${d - 1.5}:d=1.5`;
  }
}

/** Lệnh ffmpeg dựng track hiệu ứng dài `seconds` (stereo 48 kHz): mỗi tiếng đặt đúng mốc bằng adelay. */
export function sfxTrackArgs(events: SfxEvent[], seconds: number, out: string): string[] {
  const parts = events.map((e, i) => {
    const src = sfxSource(e.kind).replace(/\[([a-z]\d)\]/g, `[$1_${i}]`);
    return `${src},adelay=${Math.round(e.at * 1000)}:all=1[x${i}]`;
  });
  const silence = `anullsrc=r=48000:cl=mono,atrim=duration=${seconds.toFixed(2)}[base]`;
  const mix = `[base]${events.map((_, i) => `[x${i}]`).join("")}amix=inputs=${events.length + 1}:duration=first:normalize=0,alimiter=limit=0.95,aformat=channel_layouts=stereo[a]`;
  return ["-filter_complex", [silence, ...parts, mix].join(";"), "-map", "[a]", "-c:a", "pcm_s16le", out];
}
