// Phần có I/O của parallax 2.5D: tải mô hình độ sâu (Depth Anything V2 Small, ONNX int8), chạy bằng onnxruntime-node trên CPU,
// cache bản đồ độ sâu cạnh ảnh, dựng các file mặt nạ/ảnh vá cho ffmpeg. Lỗi ở bất cứ bước nào → trả null, người gọi rơi về zoompan.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { buildLayerMasks, DEPTH_SIZE, parsePgm, toPgm, toPpm } from "./parallax-masks";
import { canvasChain, type ParallaxFiles } from "./parallax-plan";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";

const MODEL_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx";
/** Thư mục cache mô hình (actions/cache trong workflow); đặt DEPTH_MODEL_PATH để dùng file có sẵn. */
const MODEL_FILE = process.env.DEPTH_MODEL_PATH ?? path.resolve(".cache/depth/depth-anything-v2-small-int8.onnx");
const MODEL_MIN_BYTES = 20_000_000;
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];
/** Số luồng của onnxruntime: runner chỉ 2 vCPU, ffmpeg song song cũng cần CPU. */
const ORT_THREADS = 2;

/** Tải mô hình về 1 lần (ghi file tạm rồi đổi tên để không để lại file dở); trả đường dẫn. */
export async function ensureDepthModel(file = MODEL_FILE): Promise<string> {
  const ok = await stat(file).then((s) => s.size >= MODEL_MIN_BYTES, () => false);
  if (ok) return file;
  await mkdir(path.dirname(file), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Tải mô hình độ sâu lỗi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MODEL_MIN_BYTES) throw new Error(`Mô hình độ sâu tải về quá nhỏ (${buf.length} byte)`);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, file);
  return file;
}

type Ort = typeof import("onnxruntime-node");
type Session = Awaited<ReturnType<Ort["InferenceSession"]["create"]>>;
let sessionPromise: Promise<{ ort: Ort; session: Session }> | null = null;
/** Chỉ cho 1 lượt suy luận chạy một lúc (ORT đã dùng đủ luồng; nhiều ảnh song song chỉ tranh CPU với ffmpeg). */
let queue: Promise<unknown> = Promise.resolve();

function loadSession() {
  sessionPromise ??= (async () => {
    const ort = await import("onnxruntime-node");
    const session = await ort.InferenceSession.create(await ensureDepthModel(), { intraOpNumThreads: ORT_THREADS, graphOptimizationLevel: "all" });
    return { ort, session };
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

/** Độ sâu tương đối (lớn = gần) của ảnh RGB `DEPTH_SIZE`² (rgb24). */
async function inferDepth(rgb: Uint8Array): Promise<Float32Array> {
  const { ort, session } = await loadSession();
  const n = DEPTH_SIZE * DEPTH_SIZE;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (rgb[i * 3 + c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
  const job = queue.then(() => session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, DEPTH_SIZE, DEPTH_SIZE]) }));
  queue = job.catch(() => undefined);
  const out = await job;
  return Float32Array.from(out[session.outputNames[0]].data as Float32Array);
}

/** Ảnh → RGB DEPTH_SIZE² đúng khung cắt của video (để độ sâu khớp khung hình). */
async function sampleRgb(img: string, w: number, h: number, logoCrop: string): Promise<Uint8Array> {
  const { stdout } = await run(
    FFMPEG,
    ["-v", "error", "-i", img, "-vf", `${canvasChain(w, h, logoCrop)},scale=${DEPTH_SIZE}:${DEPTH_SIZE}:flags=area`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  if (stdout.length !== DEPTH_SIZE * DEPTH_SIZE * 3) throw new Error("Đọc ảnh mẫu cho độ sâu sai kích thước");
  return new Uint8Array(stdout);
}

/** Đường dẫn bản đồ độ sâu cache cạnh ảnh (có kích thước khung để đổi khung cắt thì tính lại). */
export const depthCachePath = (img: string, w: number, h: number) => `${img}.depth-${w}x${h}.pgm`;

/** Độ sâu (8 bit, 0 xa → 255 gần) của ảnh; đọc cache cạnh ảnh nếu có, không thì suy luận rồi ghi cache. */
async function depthFor(img: string, rgb: Uint8Array, w: number, h: number): Promise<Float32Array> {
  const cache = depthCachePath(img, w, h);
  const cached = await readFile(cache).then((b) => parsePgm(b, DEPTH_SIZE), () => null);
  if (cached) return Float32Array.from(cached);
  const raw = await inferDepth(rgb);
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of raw) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const gray = Uint8Array.from(raw, (v) => Math.round((255 * (v - lo)) / Math.max(hi - lo, 1e-6)));
  await writeFile(cache, toPgm(gray, DEPTH_SIZE)).catch(() => undefined);
  return Float32Array.from(gray);
}

/**
 * Dựng các file đầu vào cho đồ thị parallax của 1 ảnh (độ sâu → mặt nạ + ảnh vá) trong `workDir`.
 * Trả null khi lỗi (thiếu mô hình/mạng, onnxruntime không chạy…) — người gọi dùng zoompan như cũ.
 */
export async function prepareParallax(o: { img: string; workDir: string; w: number; h: number; logoCrop: string }): Promise<ParallaxFiles | null> {
  try {
    const rgb = await sampleRgb(o.img, o.w, o.h, o.logoCrop);
    const depth = await depthFor(o.img, rgb, o.w, o.h);
    const m = buildLayerMasks(depth, rgb);
    await mkdir(o.workDir, { recursive: true });
    const files: ParallaxFiles = {
      farFill: path.join(o.workDir, "far-fill.ppm"),
      farPatch: path.join(o.workDir, "far-patch.pgm"),
      midFill: path.join(o.workDir, "mid-fill.ppm"),
      midPatch: path.join(o.workDir, "mid-patch.pgm"),
      midAlpha: path.join(o.workDir, "mid-alpha.pgm"),
      nearAlpha: path.join(o.workDir, "near-alpha.pgm"),
    };
    await Promise.all([
      writeFile(files.farFill, toPpm(m.farFill, DEPTH_SIZE)),
      writeFile(files.farPatch, toPgm(m.farPatch, DEPTH_SIZE)),
      writeFile(files.midFill, toPpm(m.midFill, DEPTH_SIZE)),
      writeFile(files.midPatch, toPgm(m.midPatch, DEPTH_SIZE)),
      writeFile(files.midAlpha, toPgm(m.mid, DEPTH_SIZE)),
      writeFile(files.nearAlpha, toPgm(m.near, DEPTH_SIZE)),
    ]);
    return files;
  } catch (e) {
    console.warn("⚠ Parallax lỗi, dùng zoompan:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Xoá thư mục tạm của parallax (an toàn khi không tồn tại). */
export const cleanupParallax = (workDir: string) => rm(workDir, { recursive: true, force: true });
