// Clip động: nối i2v-plan (thuần) + kaggle.ts (mạng) + ffmpeg + AI viết prompt chuyển động. Gọi từ render.ts (chương nội bộ) và CLI "kaggle-test".
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { textProvider } from "@/lib/ai";
import { ffmpeg, once, pool } from "./ffmpeg";
import { CLIP_HEIGHT, CLIP_WIDTH, clipSegmentArgs, gpuMinutes, motionPrompt, pickClipScenes, type ClipJob, type SceneSpan } from "./i2v-plan";
import type { Tracker } from "./progress";
import { finishI2v, kaggleAuth, KERNEL_TIMEOUT_MINUTES, runI2v, startI2v, type I2vEvents, type I2vOutcome, type I2vSession } from "./kaggle";
import type { I2vClip, I2vProgress, I2vStage } from "@/lib/flow/progress";
import { stillFrames } from "./still";

/** Ảnh gửi Kaggle: bỏ vùng logo, scale/crop về đúng kích thước clip (nhỏ ≈ 100 KB thay vì 2,5 MB). */
export async function prepareClipImage(src: string, out: string, logoCrop = ""): Promise<void> {
  await ffmpeg(["-i", src, "-vf", `${logoCrop}scale=${CLIP_WIDTH}:${CLIP_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${CLIP_WIDTH}:${CLIP_HEIGHT}`, "-q:v", "3", "-frames:v", "1", out]);
}

/** AI rẻ viết prompt chuyển động (tiếng Anh) cho từng cảnh từ prompt ảnh + đoạn truyện. Thiếu/lỗi thì dùng chuyển động chung an toàn. */
export async function motionPrompts(scenes: { prompt: string; text: string }[]): Promise<string[]> {
  const fallback = "spiritual energy aura bursting around the character, hair and robe whipping in a strong wind, glowing particles swirling";
  try {
    const { motions } = await textProvider().generateJson({
      system: "You write short motion prompts for an image-to-video model (LTX-Video). Describe dramatic xianxia visual effects and strong motion around the characters already in the picture — the model distorts faces and invents objects when asked for body actions or camera moves.",
      prompt:
        "For each scene write ONE English motion prompt (12–25 words) of DRAMATIC, clearly visible motion fitting the story: qi aura erupting, lightning crackling, energy shockwave rippling, flames roaring, sparks and debris flying, storm clouds churning, strong wind whipping hair and robes, glowing eyes, small head turn. " +
        "Characters keep their pose (no walking, fighting, swinging weapons), NO camera moves, no new characters. Return one item per scene in order.\n\n" +
        scenes.map((s, i) => `${i + 1}. IMAGE: ${s.prompt.slice(0, 300)}\n   STORY: ${s.text.slice(0, 400)}`).join("\n\n"),
      schema: z.object({ motions: z.array(z.string()) }),
      temperature: 0.6,
      tier: "cheap",
      task: "scenes",
    });
    return scenes.map((_, i) => motionPrompt(motions[i] || fallback));
  } catch (e) {
    console.warn("⚠ Không viết được prompt chuyển động, dùng mẫu chung:", e instanceof Error ? e.message : e);
    return scenes.map(() => motionPrompt(fallback));
  }
}

/** Đoạn video 1080p của cảnh có clip: clip (lanczos) → mờ chéo sang ảnh tĩnh nếu đoạn dài hơn. Dựng một lần (job chạy lại thì dùng lại). */
export async function buildClipSegment(o: { clip: string; img: string; file: string; start: number; end: number; w: number; h: number; logoCrop: string }): Promise<void> {
  await once(o.file, (tmp) => ffmpeg(clipSegmentArgs({ clip: o.clip, img: o.img, out: tmp, frames: stillFrames(o.start, o.end), w: o.w, h: o.h, logoCrop: o.logoCrop })));
}

/** Sau khi dựng xong các đoạn tĩnh, chờ Kaggle thêm tối đa ngần này phút (kể từ lúc đẩy lên, trần KERNEL_TIMEOUT_MINUTES). */
const MAX_WAIT_AFTER_STILLS_MINUTES = 40;

/** Kết quả đã lưu ở đĩa để job render chạy lại (bị huỷ giữa chừng) không đẩy Kaggle lần nữa. */
type SavedRun = { session: I2vSession; clips: I2vClip[] };

/**
 * Một lượt clip động của MỘT chương nội bộ. `begin` (không chặn) đẩy ảnh các cảnh đã chọn lên Kaggle;
 * `collect` chờ kết quả có hạn rồi trả { cảnh → file mp4 }. Mọi lỗi (thiếu token, không GPU, quá hạn) → Map rỗng, render dùng ảnh tĩnh.
 */
export class I2vRun {
  readonly picks: number[];
  private started: Promise<I2vSession | null> = Promise.resolve(null);
  private clips: I2vClip[] = [];
  private readonly stateFile: string;

  constructor(
    private readonly o: {
      videoId: number;
      dir: string;
      name: string;
      scenes: (SceneSpan & { text: string })[];
      prompts: { prompt: string }[];
      logoCrop: string;
      /** Báo tiến độ cho màn flow. */
      report: { progress: (patch: Partial<I2vProgress>) => void; log: (text: string) => void; total: (n: number) => void; tick: (text: string) => void; model: (m: string) => void };
    },
  ) {
    this.picks = pickClipScenes(o.scenes);
    this.stateFile = path.join(o.dir, `${o.name}-i2v-state.json`);
  }

  private stage(stage: I2vStage) {
    this.o.report.progress({ stage, clips: this.clips });
  }

  /** Đẩy lên Kaggle ngay khi ảnh các cảnh đã chọn vẽ xong (`imageOf(i)` = đường dẫn ảnh). Không ném, không chặn. */
  begin(imageOf: (scene: number) => string): void {
    this.o.report.total(this.picks.length);
    this.started = this.start(imageOf).catch((e) => {
      this.o.report.log(`⚠ Clip động: ${e instanceof Error ? e.message : e}`);
      return null;
    });
  }

  private async start(imageOf: (scene: number) => string): Promise<I2vSession | null> {
    const saved = await readFile(this.stateFile, "utf8").then((t) => JSON.parse(t) as SavedRun, () => null);
    if (saved) {
      this.clips = saved.clips;
      this.o.report.log("Dùng lại phiên Kaggle của lần chạy trước");
      this.stage("running");
      return saved.session;
    }
    this.stage("upload");
    const motions = await motionPrompts(this.picks.map((i) => ({ prompt: this.o.prompts[i].prompt, text: this.o.scenes[i].text })));
    this.clips = this.picks.map((scene, k) => ({ scene, motion: motions[k] }));
    this.o.report.progress({ clips: this.clips });
    const jobs: (ClipJob & { file: string })[] = [];
    for (const [k, scene] of this.picks.entries()) {
      const file = path.join(this.o.dir, `${this.o.name}-i2v-in-${scene}.jpg`);
      await prepareClipImage(imageOf(scene), file, this.o.logoCrop);
      jobs.push({ id: scene, image: `scene-${scene}.jpg`, prompt: motions[k], file });
    }
    const events = this.events();
    const res = await startI2v({ videoId: this.o.videoId, dir: this.o.dir, jobs, events });
    if ("error" in res) {
      this.o.report.log(`⚠ Không đẩy được lên Kaggle: ${res.error}`);
      this.o.report.progress({ stage: undefined, clips: this.clips });
      return null;
    }
    await writeFile(this.stateFile, JSON.stringify({ session: res.session, clips: this.clips } satisfies SavedRun));
    this.o.report.progress({ kernelUrl: res.session.kernelUrl });
    return res.session;
  }

  private events(): I2vEvents {
    return {
      stage: (stage, detail) => {
        this.stage(stage);
        this.o.report.log(`Kaggle: ${stage}${detail ? ` — ${detail}` : ""}`);
      },
      log: (t) => this.o.report.log(t),
    };
  }

  /** Chờ Kaggle (có hạn), tải clip về, trả { cảnh → mp4 }. Khi lỗi trả Map rỗng và `failure` có lý do. */
  async collect(): Promise<{ clips: Map<number, string>; failure: string | null }> {
    const session = await this.started;
    if (!session) return { clips: new Map(), failure: "Không đẩy được lên Kaggle" };
    const deadline = Math.min(session.startedAt + KERNEL_TIMEOUT_MINUTES * 60_000, Date.now() + MAX_WAIT_AFTER_STILLS_MINUTES * 60_000);
    const out: I2vOutcome = await finishI2v({
      session,
      dir: this.o.dir,
      deadline,
      prefix: this.o.name,
      events: {
        ...this.events(),
        partial: (results) => this.merge(results),
        clip: (r) => this.o.report.tick(`Clip cảnh ${r.id + 1}: GPU ${r.seconds}s`),
      },
    });
    this.merge(out.results);
    this.clips = this.clips.map((c) => (out.clips.has(c.scene) ? { ...c, file: this.assetName(c.scene) } : { ...c, ok: false }));
    const gpu = out.model?.split(" · ")[1];
    if (out.model) this.o.report.model(out.model.split(" · ")[0]);
    this.o.report.progress({ stage: out.clips.size ? "done" : undefined, clips: this.clips, ...(gpu ? { gpu } : {}), gpuMinutes: gpuMinutes(out.gpuSeconds), ...(out.kernelUrl ? { kernelUrl: out.kernelUrl } : {}) });
    return { clips: out.clips, failure: out.clips.size ? null : (out.reason ?? "Không có clip nào") };
  }

  /** Gộp kết quả từng clip (giây GPU, thành/bại) vào tiến độ để màn flow hiện "x/y clip" khi đang chạy. */
  private merge(results: { id: number; ok: boolean; seconds: number }[]) {
    const byId = new Map(results.map((r) => [r.id, r]));
    this.clips = this.clips.map((c) => {
      const r = byId.get(c.scene);
      return r ? { ...c, seconds: Math.round(r.seconds), ok: r.ok } : c;
    });
    this.o.report.progress({ stage: "running", clips: this.clips });
  }

  /** Tên asset (release) của clip cảnh `scene`, khớp `I2vClip.file`. */
  assetName = (scene: number) => `${this.o.name}-clip-${scene}.mp4`;
}

/** Clip động trên GPU free của Kaggle: chỉ khi có token (Actions) và chưa tắt bằng I2V=0; thiếu/lỗi thì cứ ảnh tĩnh. */
export function newI2vRun(o: { videoId: number; dir: string; track: Tracker; scenes: { start: number; end: number; zoom?: boolean; text: string }[]; prompts: { prompt: string; action: boolean }[]; logoCrop: string }) {
  const enabled = Boolean(kaggleAuth()) && process.env.I2V !== "0" && Boolean(process.env.GITHUB_ACTIONS || process.env.I2V === "1");
  if (!enabled) return undefined;
  const { track } = o;
  return new I2vRun({
    videoId: o.videoId, dir: o.dir, name: "long", logoCrop: o.logoCrop,
    scenes: o.scenes.map((x, i) => ({ start: x.start, end: x.end, zoom: x.zoom, action: o.prompts[i].action, text: x.text })),
    prompts: o.prompts,
    report: {
      progress: (patch) => track.i2v(patch),
      log: (text) => track.log("i2v", text),
      total: (n) => track.total("i2v", "long", n),
      tick: (text) => track.tick("i2v", "long", text),
      model: (m) => track.model("i2v", m),
    },
  });
}

/** CLI `kaggle-test`: 2 ảnh thật (long-img-1*.jpg trong `dir`) → 2 clip trên Kaggle, in thời gian từng bước. */
export async function kaggleTest(dir = "/tmp/i2v-in", logoCrop = ""): Promise<void> {
  const t0 = Date.now();
  const lap = (what: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${what}`);
  const images = (await readdir(dir)).filter((f) => /^long-img-1\d*\.jpg$/.test(f)).sort().slice(0, 2);
  if (images.length < 2) throw new Error(`Cần 2 ảnh long-img-1*.jpg trong ${dir} (gh release download video-16 -p 'long-img-1*.jpg')`);
  const work = path.join(dir, "kaggle-test");
  await mkdir(work, { recursive: true });
  const motions = [
    "purple demonic aura erupting and swirling around him, hair and robe whipping in a strong wind, candle flames roaring, sparks flying",
    "golden lightning crackling across the sky, storm clouds churning, robe billowing in a violent wind, glowing qi shockwave rippling outward",
  ].map(motionPrompt);
  const jobs: (ClipJob & { file: string })[] = [];
  for (const [id, name] of images.entries()) {
    const file = path.join(work, `in-${id}.jpg`);
    await prepareClipImage(path.join(dir, name), file, logoCrop);
    jobs.push({ id, image: `in-${id}.jpg`, prompt: motions[id], file });
  }
  lap(`Chuẩn bị ${jobs.length} ảnh (${images.join(", ")})`);
  const out = await runI2v({
    videoId: 0,
    dir: work,
    jobs,
    events: {
      stage: (s, d) => lap(`Giai đoạn: ${s}${d ? ` — ${d}` : ""}`),
      clip: (r) => lap(`Clip ${r.id} xong: GPU ${r.seconds}s → ${r.file}`),
    },
  });
  lap(out.reason ? `KHÔNG có đủ clip: ${out.reason}` : "Xong");
  console.log(JSON.stringify({ clips: [...out.clips.entries()], results: out.results, model: out.model, gpuSeconds: out.gpuSeconds, kernel: out.kernelUrl }, null, 2));
  await pool([...out.clips.values()], 2, async (f) => {
    const w = f.replace(/\.mp4$/, "-1080.mp4");
    await ffmpeg(["-i", f, "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-crf", "20", w]);
    lap(`Upscale 1080p: ${w}`);
  });
}
