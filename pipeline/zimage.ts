// AI vẽ phụ miễn phí: Z-Image-Turbo (Apache 2.0) trên GPU Kaggle, vẽ một phần cảnh của chương để đỡ lượt GPT.
// Kaggle chỉ trả output khi kernel XONG → đẩy lên đầu lượt render, chờ có hạn ở cuối; cảnh nào không về thì GPT vẽ bù.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { recordUsage } from "@/lib/ai/usage";
import { ffmpeg } from "./ffmpeg";
import { createDataset, deleteDataset, downloadTo, kaggleAuth, kernelOutput, kernelState, pushKernel, recordGpuUsage } from "./kaggle";

export const ZIMAGE_MODEL = "Z-Image-Turbo";
/** Đo trên T4 (bf16 giả lập): ~150s/ảnh + ~5 phút nạp model. 16 ảnh ≈ 45 phút — vừa khung chờ clip động. */
export const ZIMAGE_PER_CHAPTER = Number(process.env.ZIMAGE_PER_CHAPTER ?? 16);
/** Chờ tối đa (phút, tính từ lúc đẩy kernel) trước khi bỏ Kaggle và để GPT vẽ bù. */
export const ZIMAGE_MAX_WAIT_MINUTES = Number(process.env.ZIMAGE_MAX_WAIT_MINUTES ?? 55);
/** 1280×768 bf16 OOM trên T4 (attention 1,65 GiB) → vẽ 1024×576 rồi để khâu dựng phóng lên. */
const SIZE = { width: 1024, height: 576 };

/**
 * Chọn cảnh giao Kaggle: bỏ cảnh 2 phút đầu (`zoom`, quan trọng giữ chân người xem), bỏ cảnh làm clip động
 * (cần ảnh sớm), rồi rải đều trong phần còn lại. Thuần, để test.
 */
export function pickZImageScenes(scenes: { zoom?: boolean }[], exclude: number[], max = ZIMAGE_PER_CHAPTER): number[] {
  const skip = new Set(exclude);
  const pool = scenes.map((s, i) => (s.zoom || skip.has(i) ? -1 : i)).filter((i) => i >= 0);
  if (max <= 0 || !pool.length) return [];
  if (pool.length <= max) return pool;
  const step = pool.length / max;
  return Array.from({ length: max }, (_, k) => pool[Math.floor(k * step + step / 2)]);
}

export type ZImageOutcome = { images: Map<number, string>; failure: string | null };

/** Một lượt vẽ phụ của MỘT chương: `begin` không chặn; `collect` chờ có hạn rồi trả { cảnh → file jpg }. Mọi lỗi → Map rỗng. */
export class ZImageRun {
  private started: Promise<{ slug: string; dataset: string; at: number } | null> = Promise.resolve(null);

  constructor(
    readonly picks: number[],
    private readonly o: { videoId: number; dir: string; prompts: string[]; log: (text: string) => void },
  ) {}

  begin() {
    if (!this.picks.length) return;
    this.started = this.start().catch((e) => {
      this.o.log(`Z-Image: không đẩy được Kaggle — GPT vẽ hết (${e instanceof Error ? e.message.slice(0, 160) : e})`);
      return null;
    });
  }

  private async start() {
    const auth = kaggleAuth()!;
    const work = path.join(this.o.dir, "zimage");
    await mkdir(work, { recursive: true });
    const manifest = { ...SIZE, steps: 9, seed: 4242, mode: "bf16", images: this.picks.map((i) => ({ id: i, prompt: this.o.prompts[i] })) };
    const file = path.join(work, "manifest.json");
    await writeFile(file, JSON.stringify(manifest));
    const stamp = Date.now().toString(36);
    const dataset = `mts-zimg-data-${this.o.videoId}-${stamp}`;
    const slug = `mts-zimg-run-${this.o.videoId}-${stamp}`;
    await createDataset(auth, { slug: dataset, title: dataset, files: [{ name: "manifest.json", path: file }] });
    const url = await pushKernel(auth, { slug, title: slug, datasetSlug: dataset, scriptPath: path.join(process.cwd(), "kaggle/zimage/run.py") });
    this.o.log(`Z-Image: ${this.picks.length} cảnh giao Kaggle — ${url}`);
    return { slug, dataset, at: Date.now() };
  }

  async collect(): Promise<ZImageOutcome> {
    const images = new Map<number, string>();
    const s = await this.started;
    if (!s) return { images, failure: this.picks.length ? "không đẩy được kernel" : null };
    const auth = kaggleAuth()!;
    const deadline = s.at + ZIMAGE_MAX_WAIT_MINUTES * 60_000;
    let phase = "queued";
    while (Date.now() < deadline) {
      phase = (await kernelState(auth, s.slug).catch(() => ({ phase: "queued" as const }))).phase;
      if (phase === "done" || phase === "failed") break;
      await new Promise((r) => setTimeout(r, 20_000));
    }
    if (phase !== "done" && phase !== "failed") {
      void deleteDataset(auth, s.dataset);
      return { images, failure: `quá ${ZIMAGE_MAX_WAIT_MINUTES} phút` };
    }
    try {
      const out = await kernelOutput(auth, s.slug);
      const work = path.join(this.o.dir, "zimage");
      for (const f of out.files) {
        const m = /img-(\d+)\.png$/.exec(f.fileName);
        if (!m) continue;
        const png = path.join(work, `img-${m[1]}.png`);
        const jpg = path.join(work, `img-${m[1]}.jpg`);
        await downloadTo(f.url, png);
        await ffmpeg(["-i", png, "-q:v", "2", "-frames:v", "1", jpg]);
        images.set(Number(m[1]), jpg);
        void recordUsage(ZIMAGE_MODEL, false);
      }
      const secs = [...out.log.matchAll(/MTS_IMG id=\d+ ok=[01] sec=([\d.]+)/g)].reduce((a, x) => a + Number(x[1]), 0);
      if (secs > 0) await recordGpuUsage(secs + 300).catch(() => {});
      return { images, failure: images.size < this.picks.length ? `Kaggle trả ${images.size}/${this.picks.length} ảnh (${phase})` : null };
    } catch (e) {
      return { images, failure: e instanceof Error ? e.message.slice(0, 200) : String(e) };
    } finally {
      void deleteDataset(auth, s.dataset);
    }
  }
}

/** Bật khi có key Kaggle và đang chạy trên Actions (hoặc ZIMAGE=1); ZIMAGE=0 để tắt. */
export function newZImageRun(o: { videoId: number; dir: string; scenes: { zoom?: boolean }[]; prompts: string[]; exclude: number[]; log: (text: string) => void }) {
  const enabled = Boolean(kaggleAuth()) && process.env.ZIMAGE !== "0" && Boolean(process.env.GITHUB_ACTIONS || process.env.ZIMAGE === "1");
  if (!enabled) return undefined;
  const picks = pickZImageScenes(o.scenes, o.exclude);
  return picks.length ? new ZImageRun(picks, o) : undefined;
}
