import { execFile } from "node:child_process";
import { rename, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { parseIntegratedLufs } from "./still";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? "ffprobe";

export async function ffmpeg(args: string[]) {
  try {
    await run(FFMPEG, ["-hide_banner", "-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`ffmpeg lỗi: ${(err.stderr || err.message).slice(-1500)}`);
  }
}

export async function duration(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}

/** Độ to tích hợp (LUFS) của file âm thanh, đo bằng ebur128 (~1 giây cho 40 phút); không đo được thì null. */
export async function measureLufs(file: string): Promise<number | null> {
  try {
    const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 });
    return parseIntegratedLufs(stderr);
  } catch {
    return null;
  }
}

/** Chữ ký codec/kích thước/fps của các luồng — 2 file cùng chữ ký thì ghép concat `-c copy` an toàn. */
export async function streamSignature(file: string): Promise<string> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels", "-of", "json", file,
  ]);
  const streams = (JSON.parse(stdout).streams ?? []) as Record<string, unknown>[];
  return JSON.stringify(streams.map((s) => [s.codec_type, s.codec_name, s.width, s.height, s.pix_fmt, s.r_frame_rate, s.sample_rate, s.channels]));
}

/** Escape đường dẫn cho filter ffmpeg (dấu `:` và `\`). */
export function filterPath(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Chạy tối đa `limit` việc song song. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Tạo file đúng một lần: đã có bản hoàn chỉnh thì bỏ qua (job trước bị huỷ/hết giờ thì chạy tiếp, không dựng lại).
 * Ghi vào file tạm rồi mới đổi tên → file dở dang của job bị huỷ không bao giờ được dùng lại.
 */
export async function once(file: string, make: (tmp: string) => Promise<unknown>): Promise<boolean> {
  if (await stat(file).then((s) => s.size > 0, () => false)) return false;
  const tmp = file.replace(/(\.\w+)$/, ".part$1");
  await rm(tmp, { force: true });
  await make(tmp);
  await rename(tmp, file);
  return true;
}
