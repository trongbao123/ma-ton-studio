import { access, writeFile } from "node:fs/promises";
import { QuotaExhaustedError } from "@/lib/ai";
import { recordUsage } from "@/lib/ai/usage";

const MODELS = (process.env.TTS_MODELS ?? "gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts,gemini-3.8-flash-lite-tts").split(",");
const VOICE = process.env.TTS_VOICE ?? "Sadachbia";

/**
 * Đọc một khối văn bản bằng Gemini TTS, ghi WAV (24kHz mono). Thử lần lượt model khi quá tải/hết quota.
 * Free tier: gemini-3.8-flash-tts chỉ 10 lượt/ngày — các model sau là dự phòng.
 */
export async function speak(text: string, outFile: string) {
  // Đã có file từ lần chạy trước (cache GitHub Actions) thì không tốn quota đọc lại.
  if (await access(outFile).then(() => true, () => false)) return;
  let last = "";
  let limited = 0;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": process.env.GEMINI_API_KEY!,
          "Content-Type": "application/json",
          "Api-Revision": "2026-05-20",
        },
        body: JSON.stringify({
          model,
          // Chỉ gửi đúng văn bản truyện: kèm câu hướng dẫn thì model đôi khi đọc luôn câu đó.
          // Model TTS không nhận system instruction → chất giọng giữ bằng `voice` cố định.
          input: text,
          response_modalities: ["audio"],
          generation_config: { speech_config: [{ voice: VOICE, language: "vi-VN" }] },
        }),
      });
      const body = await res.json().catch(() => ({}));
      type Part = { data?: string; mime_type?: string };
      const part: Part | undefined = body?.steps?.flatMap((s: { content?: Part[] }) => s.content ?? []).find((c: Part) => c.data);
      if (res.ok && part?.data) {
        void recordUsage(model, false);
        await writeFile(outFile, toWav(Buffer.from(part.data, "base64"), part.mime_type ?? ""));
        return;
      }
      last = `${model} ${res.status}: ${body?.error?.message ?? "không có audio"}`;
      if (/per day/i.test(last)) {
        void recordUsage(model, true);
        limited++;
        break;
      }
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
    }
  }
  if (limited === MODELS.length) throw new QuotaExhaustedError(`Hết lượt giọng đọc free hôm nay. (${last})`);
  throw new Error(`TTS lỗi: ${last}`);
}

/** Một số model TTS trả PCM thô (audio/L16;rate=24000) thay vì WAV → gắn header WAV để ffmpeg đọc được. */
export function toWav(buf: Buffer, mime: string): Buffer {
  if (buf.subarray(0, 4).toString("ascii") === "RIFF") return buf;
  const rate = Number(mime.match(/rate=(\d+)/)?.[1]) || 24000;
  const channels = Number(mime.match(/channels=(\d+)/)?.[1]) || 1;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + buf.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(buf.length, 40);
  return Buffer.concat([header, buf]);
}
