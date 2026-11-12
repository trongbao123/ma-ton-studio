// Bản XEM TRƯỚC trên máy (không GPU, không lượt GPT): ~2 phút đầu một chương, giọng TTS thật, phụ đề, cắt cảnh theo câu,
// nhạc + tiếng đập. Ảnh lấy tạm từ thư mục có sẵn. In độ lệch mốc câu (ước theo ký tự → khoảng lặng thật).
// CLI: FFMPEG=/đường/dẫn/ffmpeg-có-drawtext+libass pnpm exec tsx scripts/preview.mts <chapterNumber> [seriesId] [chars] [imgDir]
// (ffmpeg Homebrew 9.x KHÔNG có drawtext/ass → chữ hook + phụ đề lỗi; dùng bản static có libass.)
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { buildStillVideo, buildVideo, narrate, pickMusic, splitScenes } from "../pipeline/render";
import { planChapterScenes } from "../pipeline/episode-plan";
import { snapToSentences } from "../pipeline/text";
import { sfxCutEvents, sfxTrackArgs } from "../pipeline/sfx";
import { ffmpeg } from "../pipeline/ffmpeg";
import { cuesForChunk, sentences } from "../pipeline/text";

const [num = "19", sid = "4", chars = "1600", imgDir = ".render/video-1", mode = "intro"] = process.argv.slice(2);
await loadSecrets(true);
const [c] = await db().select().from(chapters).where(and(eq(chapters.seriesId, Number(sid)), eq(chapters.number, Number(num))));
const [s] = await db().select().from(series).where(eq(series.id, Number(sid)));
if (!c) throw new Error("không thấy chương");
const text = c.content.slice(0, Number(chars)).replace(/[^.!?…]*$/, "");
const dir = `/tmp/preview-ch${num}`;
await mkdir(dir, { recursive: true });
const n = await narrate(text, dir, s.ttsVoice);
// Độ lệch: mốc câu ước theo ký tự so với mốc đã căn theo khoảng lặng.
const plain = cuesForChunk(sentences(text), 0, n.seconds, 70);
const shifts = n.cues.map((cu, i) => Math.abs(cu.end - (plain[i]?.end ?? cu.end))).filter((x) => x > 0.05);
console.log(`Giọng ${n.seconds.toFixed(1)}s, ${n.cues.length} cue; mốc dời ${shifts.length} lần, TB ${(shifts.reduce((a, b) => a + b, 0) / (shifts.length || 1)).toFixed(2)}s, max ${Math.max(0, ...shifts).toFixed(2)}s`);
// mode "chapter": dựng như chương nội bộ mở tập (buildStillVideo: nhịp vùng giữ chân, phụ đề từng đoạn, cắt thẳng).
const scenes = mode === "chapter"
  ? snapToSentences(planChapterScenes(n.seconds, true), n.cues).map((x) => ({ ...x, text: "" }))
  : splitScenes(n.cues, Math.round(n.seconds / 6), n.seconds);
console.log("Cắt cảnh (giây):", scenes.map((x) => x.end.toFixed(1)).join(" "));
const imgs = (await readdir(imgDir)).filter((f) => /img-\d+\.jpg$/.test(f)).sort();
for (const [i] of scenes.entries()) await copyFile(path.join(imgDir, imgs[i % imgs.length]), path.join(dir, `prev-img-${i}.jpg`));
const sfx = path.join(dir, "sfx.wav");
await ffmpeg(sfxTrackArgs([{ kind: "boom", at: 0 }, ...sfxCutEvents(scenes, n.seconds)], n.seconds, sfx));
if (mode === "chapter") {
  for (const [i] of scenes.entries()) await copyFile(path.join(dir, `prev-img-${i}.jpg`), path.join(dir, `long-img-${i}.jpg`));
  const r = await buildStillVideo({
    dir, name: "long", narration: n, scenes, prompts: scenes.map(() => ({ prompt: "", action: false })) as never, music: await pickMusic(c.number),
    w: 1920, h: 1080, imgW: 1280, imgH: 768,
  });
  console.log("Xong:", r.out);
  process.exit(0);
}
const out = await buildVideo({
  dir, name: "prev", narration: n, scenes, prompts: scenes.map(() => ({ prompt: "", action: false })) as never, music: await pickMusic(c.number), sfx,
  hook: "XEM TRƯỚC", w: 1920, h: 1080, imgW: 1280, imgH: 768, fontSize: 62, marginV: 70,
});
console.log("Xong:", out.out);
process.exit(0);
