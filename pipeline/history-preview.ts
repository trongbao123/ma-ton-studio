// BẢN DỰNG THỬ (spike, bỏ sau khi chốt phong cách) — đoạn mẫu ~40 giây kênh lịch sử để chủ kênh so với video mẫu
// (Lữ Thuận 1904): tông giấy cũ sepia, chuyển cảnh mực loang, thẻ năm vệt cọ đỏ, tranh tư liệu Commons lia chậm,
// phụ đề trắng phát sáng, nhạc sử thi + trống trận. Kèm giọng đọc thử 1 câu bằng vài giọng để chọn.
// CLI: render.ts "historypreview:<chapterId>" → release "history-preview" (công khai).
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { WIKI_USER_AGENT } from "@/lib/story/wiki-api";
import { duration, ffmpeg } from "./ffmpeg";
import { speak } from "./tts";
import { ivoiReady, speakIvoi } from "./tts-ivoi";

const run = promisify(execFile);
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const W = 1920;
const H = 1080;
const FPS = 25;
const CARD_SECONDS = 4;
const INK_SECONDS = 1.2;
const NARRATION_DELAY = 3;
const OPENING_WORDS = 105;
/** Lặng sau câu cuối trước khi nhạc tắt. */
const TAIL_SECONDS = 2.5;
const PREVIEW_IMAGES = 5;
const MIN_PREVIEW_IMAGES = 3;
const FONT_SERIF = path.resolve("pipeline/fonts/PlayfairDisplay-Black.ttf");
const FONT_SANS_DIR = path.resolve("pipeline/fonts");
const MUSIC = path.resolve("pipeline/music/Lord of the Land.mp3");
const COMMONS_QUERIES = ["Battle of Ngọc Hồi-Đống Đa", "Qianlong Annam campaign", "Pacification of Annam", "Tây Sơn", "Quang Trung", "Thăng Long 18th century"];
/** Kênh tư liệu: chỉ tranh/ảnh cùng thời — bỏ tượng đài, đền, ảnh chụp máy ảnh hiện đại. */
const MODERN_PHOTO = /statue|tượng|monument|temple|đền|lăng|museum|bảo tàng|IMG_|DSC|\d{8}_\d{6}/i;
/** Bản thử: tên file phải nhắc đúng đề tài (bản chính thức cho AI đọc mô tả ảnh) — tránh tranh lạc đề như Waterhouse. */
const ON_TOPIC = /tây sơn|quang trung|nguyễn huệ|ngọc hồi|đống đa|annam|an nam|vietnam|việt|qianlong|tho-xuong|thăng long|lê chiêu thống|tôn sĩ nghị|sun shiyi/i;
/** Ảnh nhỏ hơn ngần này (px ngang) vỡ hình khi phóng full HD. */
const MIN_IMAGE_WIDTH = 900;
const ACCEPT_LICENSE = /public domain|^pd|cc0|cc[- ]by(-sa)?[- ]\d/i;
const VOICE_SAMPLE = "Đêm 30 Tết năm Mậu Thân. Dãy núi Tam Điệp chìm trong bóng tối cuối năm. Dưới chân núi, một đạo quân vừa ăn Tết, sớm hơn mọi mái nhà trên đất Bắc.";

type CommonsImage = { title: string; url: string; license: string; artist: string };

/** Tìm + tải tối đa `want` tranh tư liệu Commons đúng đề tài, giấy phép tự do (PD/CC0/CC BY/BY-SA); trả file + thông tin ghi công. */
export async function commonsImages(dir: string, want: number): Promise<{ file: string; info: CommonsImage }[]> {
  const picked: { file: string; info: CommonsImage }[] = [];
  const seen = new Set<string>();
  for (const q of COMMONS_QUERIES) {
    if (picked.length >= want) break;
    const params = new URLSearchParams({
      action: "query", format: "json", generator: "search", gsrsearch: `${q} filetype:bitmap`, gsrnamespace: "6", gsrlimit: "12",
      prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "1920",
    });
    const searchResponse = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": WIKI_USER_AGENT } });
    const body = (await searchResponse.json()) as { query?: { pages?: Record<string, { title: string; imageinfo?: { thumburl?: string; width: number; height: number; extmetadata?: Record<string, { value: string }> }[] }> } };
    for (const p of Object.values(body.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      const license = ii?.extmetadata?.LicenseShortName?.value ?? "";
      if (!ii?.thumburl || seen.has(p.title) || MODERN_PHOTO.test(p.title) || !ON_TOPIC.test(p.title) || ii.width < MIN_IMAGE_WIDTH || !ACCEPT_LICENSE.test(license) || /\bnc\b|\bnd\b/i.test(license)) continue;
      seen.add(p.title);
      const file = path.join(dir, `img-${picked.length}.jpg`);
      const img = await fetch(ii.thumburl, { headers: { "User-Agent": WIKI_USER_AGENT } });
      if (!img.ok) continue;
      await writeFile(file, Buffer.from(await img.arrayBuffer()));
      const artist = (ii.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim().slice(0, 80);
      picked.push({ file, info: { title: p.title, url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`, license, artist } });
      console.log(`  ảnh: ${p.title} (${license})`);
      if (picked.length >= want) break;
    }
  }
  return picked;
}

/** Giọng đọc đoạn mở đầu: ivoi (nếu có key) giọng kể chuyện nam, không thì Gemini. */
async function narrate(text: string, dir: string): Promise<string> {
  if (ivoiReady()) {
    const f = path.join(dir, "voice.mp3");
    await speakIvoi(text, f, "vi_hoangnam_story_ipa");
    return f;
  }
  const f = path.join(dir, "voice.wav");
  await speak(text, f, "Charon");
  return f;
}

/** Cùng một câu bằng vài giọng nam trầm để chủ kênh chọn. */
async function voiceSamples(dir: string): Promise<string[]> {
  const out: string[] = [];
  const ivoi = ivoiReady() ? ["vi_hoangnam_story_ipa", "vi_male_duyonyx_1", "vi_male_baotrung_1", "vi_taman_phat"] : [];
  for (const v of ivoi) {
    const f = path.join(dir, `giong-ivoi-${v}.mp3`);
    await speakIvoi(VOICE_SAMPLE, f, v).then(() => out.push(f), (e) => console.warn(`  giọng ${v} lỗi:`, e instanceof Error ? e.message : e));
  }
  for (const v of ["Charon", "Algenib"]) {
    const f = path.join(dir, `giong-gemini-${v}.wav`);
    await speak(VOICE_SAMPLE, f, v).then(() => out.push(f), (e) => console.warn(`  giọng ${v} lỗi:`, e instanceof Error ? e.message : e));
  }
  return out;
}

const SEPIA = "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.08:brightness=-0.03";
const GRAIN = `noise=alls=5:allf=t,vignette=PI/4.5`;

/** Một cảnh: tranh tư liệu trên nền mờ của chính nó, đẩy máy chậm, tông giấy cũ. */
export async function imageShot(img: string, seconds: number, out: string, panRight: boolean) {
  const frames = Math.round(seconds * FPS);
  const zoom = `zoompan=z='1.04+0.10*on/${frames}':x='${panRight ? "(iw-iw/zoom)*on/" + frames : "(iw-iw/zoom)*(1-on/" + frames + ")"}':y='(ih-ih/zoom)/2':d=${frames}:s=${W}x${H}:fps=${FPS}`;
  const graph = [
    `[0:v]split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:3,eq=brightness=-0.12[bg]`,
    `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`,
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,scale=${W * 2}:${H * 2},${zoom},${SEPIA},${GRAIN},format=yuv420p[v]`,
  ].join(";");
  await ffmpeg(["-loop", "1", "-i", img, "-filter_complex", graph, "-map", "[v]", "-t", String(seconds), "-r", String(FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out]);
}

/** Thẻ năm: nền giấy tối, vệt cọ đỏ quét ngang, chữ năm hiện dần + dòng phụ. */
export async function yearCard(out: string, year: string, subtitle: string) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019");
  const graph = [
    `color=c=0x2b2116:s=${W}x${H}:d=${CARD_SECONDS}:r=${FPS},${GRAIN}`,
    `drawbox=x=(iw-900)/2:y=ih/2-70:w='900*min(1,t/0.7)':h=120:color=0x9e1b14@0.92:t=fill`,
    `drawtext=fontfile='${FONT_SERIF.replace(/\\/g, "/").replace(/:/g, "\\:")}':text='${esc(year)}':fontsize=110:fontcolor=0xf3e6c8:x=(w-tw)/2:y=h/2-text_h/2-10:alpha='min(1,max(0,(t-0.6)/0.6))'`,
    `drawtext=fontfile='${FONT_SERIF.replace(/\\/g, "/").replace(/:/g, "\\:")}':text='${esc(subtitle)}':fontsize=44:fontcolor=0xd8c7a3:x=(w-tw)/2:y=h/2+90:alpha='min(1,max(0,(t-1.3)/0.6))'`,
    `format=yuv420p`,
  ].join(",");
  await ffmpeg(["-f", "lavfi", "-i", graph, "-t", String(CARD_SECONDS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out]);
}

/** Chuyển cảnh mực loang: mặt nạ "nhiễu" sin hữu cơ, ngưỡng chạy theo tiến độ, mép mềm. */
// Vệt to, mềm (tần số thấp) + viền mực tối ở mép loang — tránh kiểu nhiễu sọc.
const INK_EXPR =
  "st(0,(sin(X/211)*cos(Y/157)+0.6*sin((X+Y)/131)*cos((X-Y)/173)+0.35*sin(X/67+Y/89)+1.95)/3.9);" +
  "st(1,clip((P*1.35-0.18-ld(0))*5,0,1));" +
  "st(2,1-abs(2*ld(1)-1));" +
  // Chỉ làm tối kênh sáng (PLANE 0) — nhân cả kênh màu U/V làm ám xanh lá.
  "if(eq(PLANE,0),(A*ld(1)+B*(1-ld(1)))*(1-0.8*ld(2)),A*ld(1)+B*(1-ld(1)))";

/** Một cảnh đã dựng: file video + độ dài. */
export type Shot = { file: string; seconds: number };

/** Nối các cảnh bằng chuyển cảnh mực loang (xfade custom), mỗi lần chồng INK_SECONDS. */
export async function joinWithInk(shots: Shot[], out: string) {
  const inputs = shots.flatMap((s) => ["-i", s.file]);
  const parts: string[] = [];
  let label = "0:v";
  let offset = shots[0].seconds - INK_SECONDS;
  for (let i = 1; i < shots.length; i++) {
    const next = `x${i}`;
    parts.push(`[${label}][${i}:v]xfade=transition=custom:expr='${INK_EXPR}':duration=${INK_SECONDS}:offset=${offset.toFixed(3)}[${next}]`);
    label = next;
    offset += shots[i].seconds - INK_SECONDS;
  }
  await ffmpeg([...inputs, "-filter_complex", parts.join(";"), "-map", `[${label}]`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", out]);
}

/** Phụ đề trắng phát sáng (ASS): chia theo câu, thời gian theo độ dài câu. */
export function glowAss(text: string, start: number, seconds: number): string {
  const sentences = text.match(/[^.!?…]+[.!?…]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
  const total = sentences.reduce((n, s) => n + s.length, 0);
  const ts = (t: number) => {
    const h = Math.floor(t / SECONDS_PER_HOUR);
    const m = Math.floor((t % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
    const s = (t % SECONDS_PER_MINUTE).toFixed(2).padStart(5, "0");
    return `${h}:${String(m).padStart(2, "0")}:${s}`;
  };
  let t = start;
  const lines = sentences.map((s) => {
    const d = (s.length / total) * seconds;
    const line = `Dialogue: 0,${ts(t)},${ts(t + d)},Glow,,0,0,0,,{\\blur10}${s}`;
    t += d;
    return line;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Glow,Be Vietnam Pro,68,&H00FFFFFF,&H00FFFFFF,&H40E8F4FF,&H00000000,1,0,0,0,100,100,0.5,0,1,6,0,2,160,160,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

/** Trống trận tổng hợp (không bản quyền): mỗi nhịp là sine trầm tắt nhanh + ầm nâu. */
const drumHit = (d = 1.6) =>
  `aevalsrc=exprs='0.9*sin(2*PI*58*t)*exp(-7*t)+0.35*sin(2*PI*96*t)*exp(-12*t)':d=${d}:sample_rate=48000`;

/** Đầu vào trộn tiếng: video đã nối, giọng đọc, mốc trống (giây), độ dài, file phụ đề ASS, file ra. */
export type AudioMix = { voice: string; video: string; drums: number[]; seconds: number; assFile: string; out: string };
const MUSIC_FADE_SECONDS = 3;
const FIRST_DRUM_INPUT = 3; // 0 video, 1 giọng, 2 nhạc, 3.. trống

/** Trộn giọng (trễ NARRATION_DELAY) + nhạc nền nhỏ + trống trận, đốt phụ đề phát sáng vào hình. */
export async function mixAudio({ voice, video, drums, seconds, assFile, out }: AudioMix) {
  const drumInputs = drums.flatMap(() => ["-f", "lavfi", "-i", drumHit()]);
  const delayMs = (s: number) => Math.round(s * MS_PER_SECOND);
  const drumLabels = drums.map((at, i) => `[${FIRST_DRUM_INPUT + i}:a]adelay=${delayMs(at)}|${delayMs(at)},volume=1.4[d${i}]`);
  const graph = [
    `[1:a]adelay=${delayMs(NARRATION_DELAY)}|${delayMs(NARRATION_DELAY)},volume=1.0[vo]`,
    `[2:a]volume=0.16,afade=t=in:d=1,afade=t=out:st=${seconds - MUSIC_FADE_SECONDS}:d=${MUSIC_FADE_SECONDS}[mu]`,
    ...drumLabels,
    `[vo][mu]${drums.map((_, i) => `[d${i}]`).join("")}amix=inputs=${2 + drums.length}:normalize=0,alimiter=limit=0.95[a]`,
    `[0:v]subtitles='${assFile.replace(/\\/g, "/").replace(/:/g, "\\:")}':fontsdir='${FONT_SANS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:")}'[v]`,
  ].join(";");
  await ffmpeg(["-i", video, "-i", voice, "-stream_loop", "-1", "-i", MUSIC, ...drumInputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-t", String(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-c:a", "aac", "-b:a", "192k", "-shortest", out]);
}

async function publishPreview(files: string[], credits: string) {
  const tag = "history-preview";
  await run("gh", ["release", "view", tag]).catch(() => run("gh", ["release", "create", tag, "--title", "Kênh lịch sử — đoạn mẫu", "--notes", "Bản dựng thử phong cách (spike)."]));
  await run("gh", ["release", "edit", tag, "--notes", `Bản dựng thử phong cách (spike).\n\n${credits}`]);
  await run("gh", ["release", "upload", tag, ...files, "--clobber"]);
  console.log(`✔ Đoạn mẫu: https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}`);
}

/** Dựng đoạn mẫu ~40 giây từ mở đầu kịch bản `chapterId` + mẫu giọng. */
export async function historyPreview(chapterId: number) {
  await loadSecrets(true);
  const [c] = await db().select().from(chapters).where(eq(chapters.id, chapterId));
  if (!c?.content) throw new Error(`Chương #${chapterId} chưa có kịch bản`);
  const dir = path.resolve(".render", `history-preview-${chapterId}`);
  await mkdir(dir, { recursive: true });
  const opening = c.content.split(/\s+/).slice(0, OPENING_WORDS).join(" ").replace(/[^.!?…]*$/, "").trim();
  console.log(`▶ Đoạn mẫu: ${opening.split(/\s+/).length} từ`);

  const voice = await narrate(opening, dir);
  const voiceSeconds = await duration(voice);
  const seconds = Math.ceil(NARRATION_DELAY + voiceSeconds + TAIL_SECONDS);
  const images = await commonsImages(dir, PREVIEW_IMAGES);
  if (images.length < MIN_PREVIEW_IMAGES) throw new Error(`Chỉ tìm được ${images.length} ảnh Commons hợp lệ`);

  const shots: Shot[] = [];
  const card = path.join(dir, "card.mp4");
  await yearCard(card, "1789", "Tháng Giêng · Mậu Thân – Kỷ Dậu");
  shots.push({ file: card, seconds: CARD_SECONDS });
  const each = (seconds - CARD_SECONDS + INK_SECONDS * images.length) / images.length;
  for (const [i, img] of images.entries()) {
    const f = path.join(dir, `shot-${i}.mp4`);
    await imageShot(img.file, each, f, i % 2 === 0);
    shots.push({ file: f, seconds: each });
  }
  const joined = path.join(dir, "joined.mp4");
  await joinWithInk(shots, joined);

  const assFile = path.join(dir, "subs.ass");
  await writeFile(assFile, glowAss(opening, NARRATION_DELAY, voiceSeconds));
  // Trống dồn mở đầu (nhanh dần) + một nhịp ở mỗi lần mực loang chuyển cảnh.
  let at = CARD_SECONDS - INK_SECONDS;
  const transitions = shots.slice(1).map((s) => {
    const mark = at + INK_SECONDS / 2;
    at += s.seconds - INK_SECONDS;
    return mark;
  });
  const drums = [0, 0.5, 0.9, 1.2, 1.42, 1.6, ...transitions];
  const out = path.join(dir, "doan-mau-lich-su.mp4");
  await mixAudio({ voice, video: joined, drums, seconds, assFile, out });

  const samples = await voiceSamples(dir);
  const credits = [
    "Ảnh (Wikimedia Commons):",
    ...images.map((i) => `- ${i.info.title} — ${i.info.artist || "không rõ tác giả"} — ${i.info.license} — ${i.info.url}`),
    'Nhạc: "Lord of the Land" — Kevin MacLeod (incompetech.com), CC BY 4.0.',
  ].join("\n");
  console.log(credits);
  if (process.env.GITHUB_ACTIONS) await publishPreview([out, ...samples], credits);
}
