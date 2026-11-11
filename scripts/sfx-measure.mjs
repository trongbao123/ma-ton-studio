// Đo tiếng hiệu ứng (pipeline/sfx.ts) bằng ffmpeg để cân biên độ — không có trong pipeline, chỉ chạy tay khi sửa SFX_TRIM_DB.
//
//   pnpm exec tsx scripts/sfx-measure.mjs            # từng loại tiếng: LUFS + đỉnh
//   pnpm exec tsx scripts/sfx-measure.mjs --mix      # thêm: track cả chương + bản trộn với giọng đọc giả
//
// File ra nằm ở .cache/sfx-measure (nghe thử trực tiếp). Cần ffmpeg trong PATH.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { SFX_KINDS, SFX_SECONDS, SFX_TRIM_DB, sfxEvents, sfxSource, sfxTrackArgs } from "../pipeline/sfx.ts";
import { AUDIO_RATE, episodeAudioGraph, SFX_GAIN, VOICE_LUFS } from "../pipeline/still.ts";

const run = promisify(execFile);
const DIR = path.resolve(".cache/sfx-measure");
const ff = (args) => run("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { maxBuffer: 1 << 26 });

/**
 * Integrated LUFS + đỉnh thật (dBFS) của một file. ebur128 in từng khung rồi mới in bản tóm tắt,
 * nên phải lấy lần khớp CUỐI — lấy lần đầu sẽ ra -70 (mức sàn lúc còn im lặng).
 */
async function measure(file) {
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const last = (re) => Number([...stderr.matchAll(re)].at(-1)?.[1]);
  return { lufs: last(/I:\s+(-?[\d.]+) LUFS/g), peak: last(/Peak:\s+(-?[\d.]+) dBFS/g), lra: last(/LRA:\s+(-?[\d.]+) LU/g) };
}

const row = (name, m) => `${name.padEnd(22)} I=${m.lufs.toFixed(1).padStart(6)} LUFS   đỉnh=${m.peak.toFixed(1).padStart(6)} dBFS`;

await mkdir(DIR, { recursive: true });

console.log("— Từng loại tiếng (sau SFX_TRIM_DB) —");
for (const kind of SFX_KINDS) {
  const out = path.join(DIR, `${kind}.wav`);
  await ff(["-filter_complex", `${sfxSource(kind)},aformat=channel_layouts=stereo[a]`, "-map", "[a]", "-c:a", "pcm_s16le", out]);
  console.log(row(`${kind} (${SFX_SECONDS[kind]}s, ${SFX_TRIM_DB[kind] >= 0 ? "+" : ""}${SFX_TRIM_DB[kind]}dB)`, await measure(out)));
}

if (!process.argv.includes("--mix")) process.exit(0);

// Một chương giả: 6 cảnh 60 giây, 6 clip như pickClipScenes hay chọn.
const SECONDS = 360;
const scenes = Array.from({ length: 6 }, (_, i) => ({ start: i * 60, end: (i + 1) * 60 }));
const motions = [
  "golden lightning crackling across the sky, storm clouds churning",
  "purple qi aura erupting, energy shockwave rippling outward",
  "robe billowing in a violent wind, hair whipping",
  "candle flames roaring, embers flying",
  "spiritual aura glowing, runes pulsing",
  "debris shattering, blast of wind",
];
const clips = motions.map((motion, scene) => ({ scene, motion, file: `clip-${scene}.mp4` }));
const events = sfxEvents(clips, scenes, SECONDS);
const track = path.join(DIR, "track.wav");
await ff(sfxTrackArgs(events, SECONDS, track));
console.log(`\n— Track cả chương (${events.length} tiếng cho ${clips.length} clip) —`);
console.log(row("sfx.wav", await measure(track)));

// Giọng đọc giả ở đúng -16 LUFS (nhiễu lọc dải tiếng nói, ngắt nhịp như câu nói) + nhạc nền giả.
const voice = path.join(DIR, "voice.wav");
await ff([
  "-filter_complex",
  `anoisesrc=c=pink:d=${SECONDS}:r=${AUDIO_RATE}:a=0.9,highpass=f=120,lowpass=f=3400,tremolo=f=2.5:d=0.85,loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11,aformat=channel_layouts=stereo[a]`,
  "-map", "[a]", "-c:a", "pcm_s16le", voice,
]);
const music = path.join(DIR, "music.wav");
await ff(["-filter_complex", `anoisesrc=c=brown:d=${SECONDS}:r=${AUDIO_RATE}:a=0.5,lowpass=f=900,aformat=channel_layouts=stereo[a]`, "-map", "[a]", "-c:a", "pcm_s16le", music]);

/** Trộn giọng + nhạc (+ hiệu ứng) đúng như episodeMuxArgs, `gain` ghi đè SFX_GAIN để dò mức. */
const mix = async (name, gain) => {
  const out = path.join(DIR, `${name}.wav`);
  const graph = episodeAudioGraph({ seconds: SECONDS, musicGain: 0.3, voiceGain: null, sfx: gain != null }).replace(`volume=${SFX_GAIN}`, `volume=${gain}`);
  await ff([
    "-f", "lavfi", "-i", `color=c=black:s=16x16:d=${SECONDS}`, "-i", voice, "-i", music, ...(gain != null ? ["-i", track] : []),
    "-filter_complex", graph, "-map", "[a]", "-c:a", "pcm_s16le", out,
  ]);
  return out;
};

/** Độ to của cửa sổ 2 giây kể từ mốc tiếng — đúng khoảng tiếng kêu, không bị 4 giây giọng pha loãng. */
const windowLufs = async (file, at) => {
  const clip = path.join(DIR, "win.wav");
  await ff(["-ss", at.toFixed(2), "-t", "2", "-i", file, "-c:a", "pcm_s16le", clip]);
  return (await measure(clip)).lufs;
};

const plain = await mix("mix-plain", null);
console.log(row("bản trộn không hiệu ứng", await measure(plain)));

// Câu hỏi thật: ở ĐÚNG mốc tiếng, bản trộn to lên bao nhiêu so với chỉ có giọng + nhạc?
// Dưới ~1 dB thì tai không nhận ra; quanh 3–5 dB là nghe rõ mà không lấn lời kể; trên ~8 dB thì chìm giọng.
console.log("\n— Dò SFX_GAIN: mức to lên tại từng mốc tiếng (cửa sổ 2 giây) —");
const baseline = [];
for (const e of events) baseline.push(await windowLufs(plain, e.at));
for (const gain of [SFX_GAIN, 1, 1.5, 2, 3]) {
  const file = await mix(`mix-gain-${gain}`, gain);
  const deltas = [];
  for (const [i, e] of events.entries()) deltas.push((await windowLufs(file, e.at)) - baseline[i]);
  const whole = await measure(file);
  const by = (kind) => deltas.filter((_, i) => events[i].kind === kind);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  console.log(
    `gain=${String(gain).padEnd(4)} tăng trung bình +${avg(deltas).toFixed(1)} dB  (nổ +${avg(by("boom")).toFixed(1)} · sấm +${avg(by("thunder")).toFixed(1)} · ì ầm +${avg(by("rumble")).toFixed(1)} · gió +${avg(by("whoosh")).toFixed(1)} · hào quang +${avg(by("energy")).toFixed(1)})  cả tập I=${whole.lufs.toFixed(1)} đỉnh=${whole.peak.toFixed(1)}`,
  );
}
console.log(`\nFile nghe thử: ${DIR}`);
