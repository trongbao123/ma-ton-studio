import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { ffmpeg } from "./ffmpeg";

/**
 * VieNeu-TTS (mã nguồn mở, Apache 2.0, chạy CPU qua ONNX — không tốn tiền, không giới hạn ký tự). Chủ kênh chọn giọng
 * 28/11/2026 sau khi nghe thử: chuyện đời nam = Đức Trí, nữ = Thục Đoan; lịch sử = Thanh Bình.
 */
export const VIENEU_PREFIX = "vieneu-";
export const VIENEU_VOICE_MALE = process.env.VIENEU_VOICE_MALE ?? "Đức Trí";
export const VIENEU_VOICE_FEMALE = process.env.VIENEU_VOICE_FEMALE ?? "Thục Đoan";
export const VIENEU_VOICE_HISTORY = process.env.VIENEU_VOICE_HISTORY ?? "Thanh Bình";

/** Giọng có sẵn theo giới/tuổi cho phân vai chuyện đời (voice-cast.ts). Ngọc Linh, Mỹ Duyên: thoại nhân vật nữ (chủ kênh khen). */
export const VIENEU_VOICES = {
  female: {
    old: [VIENEU_VOICE_FEMALE, "Mỹ Duyên", "Kim Thanh"],
    mid: ["Ngọc Linh", "Mỹ Duyên", "Đoan Trang"],
    young: ["Mỹ Duyên", "Ngọc Linh", "Quỳnh Anh"],
  },
  male: {
    old: [VIENEU_VOICE_MALE, "Thái Sơn", "Thiền Tâm Đức"],
    mid: ["Thái Sơn", "Thiện Minh", "Minh Triết"],
    young: ["Adam", "Quốc Tuấn", "Xuân Vĩnh"],
  },
} as const;

/** VieNeu không chạy được (thiếu Python/gói, nạp model lỗi) — người gọi quay về ivoi/Gemini thay vì treo video. */
export class VieneuUnavailableError extends Error {}

/** Tắt bằng `TTS_ENGINE=ivoi` (hoặc `gemini`) nếu cần quay về giọng cũ mà không sửa code. */
export const vieneuEnabled = () => (process.env.TTS_ENGINE || "vieneu") === "vieneu";

type Worker = { proc: ChildProcessWithoutNullStreams; next: () => Promise<string> };
let worker: Promise<Worker> | null = null;
/** Nạp model lần đầu (tải ~800MB nếu cache trống) / đọc 1 đoạn ≤4.000 ký tự trên CPU — quá thì coi như hỏng, quay về ivoi/Gemini. */
const READY_TIMEOUT_MS = 15 * 60_000;
const JOB_TIMEOUT_MS = 15 * 60_000;

/** Hết `ms` mà `work` chưa xong → VieneuUnavailableError (tiến trình Python treo không được giữ job tới hết 6 tiếng). */
function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new VieneuUnavailableError(`${what} quá ${ms / 60_000} phút`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/**
 * Tiến trình Python chạy nền không được giữ Node sống khi pipeline đã xong (job treo tới hết giờ): chỉ "ref" ống đọc
 * trong lúc đang chờ một đoạn, xong thì "unref".
 */
function holdOpen(proc: ChildProcessWithoutNullStreams, open: boolean) {
  for (const pipe of [proc.stdout, proc.stdin] as unknown as { ref?: () => void; unref?: () => void }[]) {
    if (open) pipe.ref?.();
    else pipe.unref?.();
  }
}

/** Model chỉ đọc tuần tự — nối các việc thành hàng để `pool(…, 3)` phía trên không gửi chồng. */
let queue: Promise<unknown> = Promise.resolve();

function startWorker(): Promise<Worker> {
  const python = process.env.VIENEU_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const script = path.join(import.meta.dirname, "tts_vieneu.py");
  // stderr (log tải model/cảnh báo của thư viện) bỏ hẳn: để ống mở thì Node không thoát được; lỗi thật trả qua stdout.
  const proc = spawn(python, [script], {
    env: { ...process.env, PYTHONIOENCODING: "utf-8", VIENEU_DEVICE: process.env.VIENEU_DEVICE ?? "cpu" },
    stdio: ["pipe", "pipe", "ignore"],
  }) as unknown as ChildProcessWithoutNullStreams;
  const lines = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
  const next = async () => {
    const r = await lines.next();
    if (r.done) throw new VieneuUnavailableError("tiến trình VieNeu đã thoát");
    return r.value;
  };
  return new Promise((resolve, reject) => {
    proc.once("error", (e) => reject(new VieneuUnavailableError(`không chạy được ${python}: ${e.message}`)));
    withTimeout(next(), READY_TIMEOUT_MS, "nạp model VieNeu").then((first) => {
      const msg = JSON.parse(first) as { ready: boolean; error?: string };
      if (!msg.ready) return reject(new VieneuUnavailableError(`nạp model lỗi: ${msg.error}`));
      proc.unref();
      holdOpen(proc, false);
      resolve({ proc, next });
    }, (e) => {
      proc.kill();
      reject(e);
    });
  });
}

/** Đọc `text` bằng giọng VieNeu `voice`, ghi WAV 24kHz mono (cùng định dạng Gemini/ivoi để nối và đo khoảng lặng như cũ). */
export function speakVieneu(text: string, outFile: string, voice: string): Promise<void> {
  const job = queue.then(async () => {
    if (await access(outFile).then(() => true, () => false)) return;
    worker ??= startWorker().catch((e) => {
      worker = null;
      throw e;
    });
    const w = await worker;
    const raw = `${outFile}.48k.wav`;
    holdOpen(w.proc, true);
    let res: { ok: boolean; error?: string };
    try {
      w.proc.stdin.write(`${JSON.stringify({ text, out: raw, voice })}\n`);
      res = JSON.parse(await withTimeout(w.next(), JOB_TIMEOUT_MS, "đọc 1 đoạn VieNeu"));
    } catch (e) {
      stopVieneu(); // tiến trình treo/chết → lần sau khởi động lại
      throw e;
    } finally {
      holdOpen(w.proc, false);
    }
    // Một đoạn đọc hỏng cũng coi như VieNeu không dùng được → cả video quay về ivoi/Gemini, không chết giữa chừng.
    if (!res.ok) throw new VieneuUnavailableError(`đọc lỗi: ${res.error}`);
    try {
      const partial = `${outFile}.tmp.wav`;
      await ffmpeg(["-y", "-i", raw, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", partial]);
      await rename(partial, outFile);
    } finally {
      await rm(raw, { force: true });
    }
  });
  queue = job.catch(() => {});
  return job;
}

/** Tắt tiến trình Python khi xong video (không để treo job). */
export function stopVieneu() {
  void worker?.then((w) => w.proc.kill()).catch(() => {});
  worker = null;
}
