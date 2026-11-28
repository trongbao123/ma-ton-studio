// Ghép video kênh lịch sử: chọn cách dựng cho từng cảnh (lùi cấp khi thiếu dữ liệu), nối lại, trộn tiếng,
// rồi kiểm tra trước khi cho đăng. Thiếu dữ liệu không bao giờ để khung trống — luôn có cảnh thay thế.
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, videos } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { loadSecrets } from "@/lib/secrets";
import { dossierText } from "@/lib/story/dossier";
import { geocodeAll, type GeoPoint } from "@/lib/story/geocode";
import { HISTORY_TEMPO } from "@/lib/story/history";
import { directScript, scenesToShots, type Shot } from "@/lib/story/storyboard";
import { duration, ffmpeg, ffmpegLog, memoizeAsync, pool } from "./ffmpeg";
import { ensureRelease, fitForRelease, uploadAsset } from "./release";
import { historyAudioArgs, musicPlan } from "./history-audio";
import { coldOpenShots, renderColdOpen } from "./history-coldopen";
import { isEngineUnavailable, narrate, narratorEngines, type Narration } from "./render";
import { artCredits, pickArtwork, renderArtScene, type ArtImage } from "./scene-art";
import { renderCardScene } from "./scene-card";
import { renderMapScene } from "./scene-map";
import { kaggleTerrainJob, renderTerrainScene, stopAfterFailure, terrainBudget } from "./scene-terrain";
import { ensureSprite, spriteDataUri } from "./sprites";
import { toAss } from "./text";

/** Các cách dựng cảnh (tiêm vào để test không chạy ffmpeg). */
export type SceneRenderers = {
  /** Trả false khi không dựng được cảnh 3D (hết giờ Kaggle, thiếu toạ độ) → lùi về bản đồ 2D. */
  terrain: (o: { shot: Shot; places: Map<string, GeoPoint>; dir: string; out: string }) => Promise<boolean>;
  map: (o: { shot: Shot; places: Map<string, GeoPoint>; dir: string; out: string }) => Promise<void>;
  card: (o: { shot: Shot; out: string }) => Promise<void>;
  art: (o: { shot: Shot; art: ArtImage; out: string }) => Promise<void>;
  findArt: (o: { shot: Shot; dir: string }) => Promise<ArtImage[]>;
  drawArt: (o: { shot: Shot; dir: string }) => Promise<ArtImage>;
};

export type SceneJob = { shot: Shot; places: Map<string, GeoPoint>; dir: string; out: string; renderers: SceneRenderers };
/** Cảnh đã dựng: loại thật sự dùng (có thể khác loại đạo diễn chọn nếu phải lùi) + ảnh đã dùng (để ghi công). */
export type RenderedScene = { kind: Shot["kind"]; images: ArtImage[] };

/** Địa danh của cảnh đã tra được toạ độ. */
const knownPlaces = (shot: Shot, places: Map<string, GeoPoint>) => (shot.route ?? shot.places ?? []).filter((name) => places.has(name));

/** Chữ tả tranh mà đạo diễn ghi cho cảnh; rỗng thì không tìm được mà cũng không vẽ được gì. */
const artSubject = (shot: Shot) => `${shot.artQuery ?? ""} ${shot.artPrompt ?? ""}`.trim();

/**
 * Tranh cho một cảnh: tìm tranh cổ trước, không có thì nhờ AI vẽ. Trả null khi chịu thua —
 * một cảnh không có tranh chỉ nên lùi về thẻ chữ, không được quyền giết cả job dựng 500+ cảnh.
 */
async function artFor({ shot, dir, renderers }: Pick<SceneJob, "shot" | "dir" | "renderers">): Promise<ArtImage | null> {
  if (!artSubject(shot)) {
    console.warn("⚠ Cảnh tranh không có artQuery lẫn artPrompt — lùi về thẻ chữ");
    return null;
  }
  try {
    const found = await renderers.findArt({ shot, dir });
    return found[0] ?? (await renderers.drawArt({ shot, dir }));
  } catch (e) {
    console.warn("⚠ Cảnh tranh: tìm và vẽ đều hỏng — lùi về thẻ chữ:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Dựng một cảnh, tự lùi cấp khi thiếu dữ liệu: 3D → bản đồ 2D → thẻ chữ; tranh tư liệu → AI vẽ (đóng nhãn "Minh họa")
 * → thẻ chữ. Luôn ra được một file, không bao giờ để khung trống.
 */
/** Đọc kịch bản lịch sử: VieNeu giọng Thanh Bình (miễn phí) → ivoi giọng tài liệu (dự phòng) → Gemini. */
async function narrateHistory(content: string, dir: string): Promise<Narration> {
  for (const engine of narratorEngines({ life: false, history: true, voice: "" })) {
    try {
      const narration = await narrate(content, dir, `${engine.prefix}${engine.narrator}`, undefined, CUE_CHARS, HISTORY_TEMPO);
      console.log(`  Giọng ${engine.name} ${engine.narrator}`);
      return narration;
    } catch (e) {
      if (!isEngineUnavailable(e)) throw e;
      console.warn(`  ⚠ ${engine.name} không dùng được (${e instanceof Error ? e.message : e}) — thử bộ máy kế tiếp`);
    }
  }
  return narrate(content, dir, HISTORY_GEMINI_VOICE, undefined, CUE_CHARS, HISTORY_TEMPO);
}

export async function pickSceneRenderer({ shot, places, dir, out, renderers }: SceneJob): Promise<RenderedScene> {
  if (shot.kind === "card") {
    await renderers.card({ shot, out });
    return { kind: "card", images: [] };
  }
  if (shot.kind === "art") {
    const art = await artFor({ shot, dir, renderers });
    if (art) {
      await renderers.art({ shot, art, out });
      return { kind: "art", images: [art] };
    }
    await renderers.card({ shot, out });
    return { kind: "card", images: [] };
  }
  // map / terrain: cần ít nhất 2 địa danh có toạ độ, không thì chuyển sang thẻ chữ.
  if (knownPlaces(shot, places).length < 2) {
    await renderers.card({ shot, out });
    return { kind: "card", images: [] };
  }
  if (shot.kind === "terrain" && (await renderers.terrain({ shot, places, dir, out }))) return { kind: "terrain", images: [] };
  await renderers.map({ shot, places, dir, out });
  return { kind: "map", images: [] };
}

/** Lệch quá ngần này giây so với giọng đọc là hỏng (hình hết trước tiếng hoặc ngược lại). */
const MAX_LENGTH_DRIFT = 2;

export type QcInput = {
  /** Độ dài giọng đọc (giây) và độ dài video đo được. */
  seconds: number;
  measured: number;
  /** Log của ffmpeg blackdetect. */
  blackLog: string;
  shots: Shot[];
  images: ArtImage[];
};

/** Soát video trước khi đăng; trả danh sách lỗi (rỗng = đạt). Còn lỗi thì giữ video lại, không đăng. */
export async function historyQc({ seconds, measured, blackLog, shots, images }: QcInput): Promise<string[]> {
  const problems: string[] = [];
  if (Math.abs(measured - seconds) > MAX_LENGTH_DRIFT)
    problems.push(`Độ dài video ${measured.toFixed(1)} giây lệch ${Math.abs(measured - seconds).toFixed(1)} giây so với giọng đọc ${seconds.toFixed(1)} giây`);
  if (/black_start/.test(blackLog)) problems.push(`Video có khoảng đen: ${blackLog.match(/black_start:[\d.]+/g)?.join(", ")}`);
  for (const image of images) {
    if (image.synthetic) continue;
    if (!image.license || !image.url) problems.push(`Ảnh "${image.title}" thiếu giấy phép hoặc đường dẫn để ghi công`);
  }
  if (!shots.length) problems.push("Không có cảnh nào");
  return problems;
}

const VIDEO_W = 1920;
const VIDEO_H = 1080;
const SUBTITLE_SIZE = 68;
const SUBTITLE_MARGIN = 100;
/** Chữ mỗi mốc phụ đề — dài hơn thì một dòng tràn màn hình. */
const CUE_CHARS = 70;
/** Giọng Gemini khi cả VieNeu lẫn ivoi đều không dùng được (trầm, hợp thuyết minh). */
const HISTORY_GEMINI_VOICE = "Algenib";
const PROGRESS_EVERY = 10;
/** Runner GitHub có 4 nhân — dựng 3 cảnh cùng lúc, chừa một nhân cho ffmpeg ghép và hệ thống. */
const SCENE_PARALLEL_DEFAULT = 3;
/** Đổi byte sang MB cho dòng log kích thước file. */
const BYTES_PER_MB = 1_000_000;
const SCENE_PARALLEL = Math.max(1, Number(process.env.SCENE_PARALLEL ?? SCENE_PARALLEL_DEFAULT));
const ART_SEED = 11;

const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/** `dir` là thư mục GỐC của video (không phải của một cảnh) — chỗ để thứ dùng chung như sprite lính giấy. */
export type RendererSetup = { videoId: number; era: string; side: string; topicTerms: string[]; dir: string; log: (text: string) => void };

/** Bộ dựng cảnh thật (gọi ffmpeg, Kaggle, Commons, Codex). */
function realRenderers(setup: RendererSetup): SceneRenderers {
  const budget = terrainBudget();
  const runOnKaggle = stopAfterFailure(kaggleTerrainJob({ videoId: setup.videoId, log: setup.log }), (reason) =>
    setup.log(`Tắt cảnh 3D cho cả video sau lần Kaggle hỏng đầu tiên (${reason}) — các cảnh sau dùng bản đồ 2D`),
  );
  // Lính giấy vẽ MỘT lần cho cả video, để ở thư mục gốc: trước đây mỗi cảnh một thư mục riêng nên cảnh nào
  // cũng trượt cache và gọi AI vẽ lại (Codex vài phút/ảnh) — hàng trăm cảnh bản đồ là hàng giờ đốt không công.
  const infantrySprite = memoizeAsync(() =>
    ensureSprite({ kind: "infantry", side: setup.side, era: setup.era, dir: setup.dir })
      .then(spriteDataUri)
      .catch((e: unknown) => {
        setup.log(`Không vẽ được lính giấy: ${e instanceof Error ? e.message : e}`);
        return undefined;
      }),
  );
  return {
    terrain: ({ shot, places, dir, out }) => renderTerrainScene({ shot, places, dir, out, budget, runOnKaggle }),
    map: async ({ shot, places, dir, out }) => {
      const infantry = await infantrySprite();
      await renderMapScene({ shot, places, sprites: infantry ? { infantry } : {}, dir, out });
    },
    card: ({ shot, out }) => renderCardScene({ shot, out }),
    art: ({ shot, art, out }) => renderArtScene({ shot, art, out }),
    findArt: ({ shot, dir }) => pickArtwork({ query: shot.artQuery ?? "", topicTerms: setup.topicTerms, dir, want: 1 }),
    drawArt: async ({ shot, dir }) => {
      const { drawImage } = await import("./images");
      const file = path.join(dir, "art-ai.jpg");
      const prompt = `${shot.artPrompt ?? shot.artQuery ?? ""}. Style: old woodblock print / engraving, aged paper, muted sepia, period-correct clothing and weapons, no text, no modern objects.`;
      await drawImage(prompt, file, { width: VIDEO_W, height: VIDEO_H, seed: ART_SEED });
      return { file, title: "Minh họa", url: "", license: "", artist: "", synthetic: true };
    },
  };
}

/** Nối các cảnh bằng cắt thẳng (danh sách concat của ffmpeg). */
async function concatScenes(files: string[], listFile: string, out: string) {
  await writeFile(listFile, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out]);
}

/** Video không qua soát QC — giữ lại, không đăng. */
export class HistoryQcError extends Error {
  constructor(readonly problems: string[]) {
    super(`Video chưa đạt kiểm tra:\n- ${problems.join("\n- ")}`);
  }
}

/** Đường dẫn job Actions đang chạy, để màn Studio bấm vào xem log. */
const runUrl = () =>
  process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null;

/**
 * Cất video vừa dựng: đẩy file lên release của video rồi ghi lại vào DB. KHÔNG cất thì file nằm trong
 * thư mục tạm của máy chạy job và mất sạch lúc job kết thúc — đúng chuyện đã xảy ra với video #91.
 * Cất cả khi QC trượt, để chủ kênh còn xem tận mắt hỏng ở đâu.
 */
async function keepVideo(videoId: number, file: string, seconds: number, problems: string[]) {
  const releaseId = await ensureRelease(videoId, true);
  // Quá 2 GiB thì GitHub từ chối → nén lại trước; vẫn đẩy lên với tên long.mp4 (publish đọc tên này).
  await uploadAsset(videoId, releaseId, await fitForRelease(file, seconds), "long.mp4");
  await db()
    .update(videos)
    .set({
      status: problems.length ? "failed" : "ready",
      durationSec: Math.round(seconds),
      error: problems.length ? problems.join("\n").slice(0, 2000) : null,
      updatedAt: new Date(),
    })
    .where(eq(videos.id, videoId));
}

/**
 * Dựng trọn video lịch sử cho `videoId`: giọng đọc → Claude đạo diễn → dựng từng cảnh (tự lùi cấp) →
 * mở đầu trailer → nối, đốt phụ đề, trộn tiếng → soát QC → cất vào release. Không đạt QC thì vẫn cất
 * file lại nhưng ném HistoryQcError (không đăng). `images`/`musicFiles`: để bên gọi (historyauto) ghi công
 * và chọn ảnh thumbnail — không phải vẽ lại hay tính lại gì ở đây.
 */
export async function renderHistoryVideo(videoId: number): Promise<{ file: string; credits: string; seconds: number; images: ArtImage[]; musicFiles: string[] }> {
  await loadSecrets(true);
  const [row] = await db()
    .select({ chapter: chapters })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(eq(videos.id, videoId));
  const chapter = row?.chapter;
  if (!chapter?.content) throw new Error(`Video #${videoId} chưa có kịch bản`);
  if (!chapter.dossier) throw new Error(`Chương #${chapter.id} chưa gom hồ sơ tư liệu`);
  const dir = path.resolve(".render", `history-${videoId}`);
  await mkdir(dir, { recursive: true });
  // Đánh dấu đang dựng ngay từ đầu: không có dòng này thì màn Studio treo ở "Chờ render" suốt mấy tiếng.
  await db().update(videos).set({ status: "rendering", error: null, runUrl: runUrl(), updatedAt: new Date() }).where(eq(videos.id, videoId));
  const log = (text: string) => console.log(`  ${text}`);

  const narration = await narrateHistory(chapter.content, dir);
  log(`Giọng đọc ${narration.seconds.toFixed(0)} giây`);
  const sources = dossierText(chapter.dossier);
  const scenes = await directScript(textProvider(), chapter.content, sources);
  const shots = scenesToShots(scenes, narration.cues, narration.seconds);
  log(`Đạo diễn ${shots.length} cảnh`);

  const places = await geocodeAll(shots.flatMap((s) => [...(s.places ?? []), ...(s.route ?? []), ...(s.battles ?? [])]));
  const renderers = realRenderers({ videoId, era: chapter.title, side: "quân đội thời kỳ đó", topicTerms: [chapter.title.split(":")[0].trim()], dir, log });
  // Dựng nhiều cảnh cùng lúc: mỗi cảnh chỉ ăn một nhân CPU (Resvg + ffmpeg), chạy tuần tự thì 3 nhân còn lại
  // của runner ngồi không. pool() trả kết quả ĐÚNG thứ tự đầu vào nên thứ tự cảnh không đổi.
  let done = 0;
  const built = await pool(shots, SCENE_PARALLEL, async (shot, i) => {
    const sceneDir = path.join(dir, `scene-${String(i).padStart(3, "0")}`);
    await mkdir(sceneDir, { recursive: true });
    const out = path.join(sceneDir, "scene.mp4");
    const used = await pickSceneRenderer({ shot, places, dir: sceneDir, out, renderers });
    // Khung PNG chỉ để ghép ra mp4 của cảnh (~103 KB/khung, ~13 MB mỗi cảnh 5 giây) — giữ lại cả 456 cảnh
    // là ~6 GB đĩa runner, đủ để job chết vì hết chỗ ở khúc cuối.
    await rm(path.join(sceneDir, "frames"), { recursive: true, force: true });
    done++;
    if (done % PROGRESS_EVERY === 0 || done === shots.length) log(`Dựng cảnh ${done}/${shots.length}`);
    return { out, images: used.images };
  });
  const sceneFiles = built.map((b) => b.out);
  const images = built.flatMap((b) => b.images);

  const body = path.join(dir, "body.mp4");
  await concatScenes(sceneFiles, path.join(dir, "scenes.txt"), body);

  const subs = path.join(dir, "subs.ass");
  await writeFile(subs, toAss(narration.cues, { width: VIDEO_W, height: VIDEO_H, fontSize: SUBTITLE_SIZE, marginV: SUBTITLE_MARGIN }));
  const withSubs = path.join(dir, "body-subs.mp4");
  await ffmpeg(["-i", body, "-vf", `subtitles='${filterPath(subs)}':fontsdir='pipeline/fonts'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-an", withSubs]);
  const mixed = path.join(dir, "mixed.mp4");
  await ffmpeg(historyAudioArgs({ voice: narration.audio, video: withSubs, shots, seconds: narration.seconds, out: mixed }));

  const openParts = coldOpenShots(shots).map((shot) => {
    const index = shots.findIndex((s) => s.from === shot.from && s.to === shot.to);
    return { shot, file: sceneFiles[index >= 0 ? index : 0] };
  });
  const coldOpen = path.join(dir, "coldopen.mp4");
  await renderColdOpen({ parts: openParts, dir, out: coldOpen });

  const file = path.join(dir, "long.mp4");
  await concatScenes([coldOpen, mixed], path.join(dir, "final.txt"), file);

  const measured = await duration(file);
  const blackLog = await ffmpegLog(["-i", file, "-vf", "blackdetect=d=0.6:pix_th=0.1", "-an", "-f", "null", "-"]);
  const openSeconds = openParts.reduce((n, p) => n + (p.shot.end - p.shot.start), 0);
  const problems = await historyQc({ seconds: narration.seconds + openSeconds, measured, blackLog, shots, images });
  log(`Cất video vào kho (${((await stat(file)).size / BYTES_PER_MB).toFixed(0)} MB)`);
  await keepVideo(videoId, file, measured, problems);
  if (problems.length) throw new HistoryQcError(problems);
  log(`Video xong: ${measured.toFixed(0)} giây`);
  const musicFiles = [...new Set(musicPlan(shots).map((segment) => segment.file))];
  return { file, credits: artCredits(images), seconds: measured, images, musicFiles };
}
