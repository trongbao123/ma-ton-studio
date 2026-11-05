import { access, writeFile } from "node:fs/promises";
import { QuotaExhaustedError } from "@/lib/ai";
import { recordUsage } from "@/lib/ai/usage";

const MODELS = (process.env.TTS_MODELS ?? "gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts,gemini-3.8-flash-lite-tts").split(",");
const VOICE = process.env.TTS_VOICE ?? "Charon";

/** Đọc một khối văn bản bằng Gemini TTS, ghi WAV (24kHz mono). Thử lần lượt model khi quá tải/hết quota. */
export async function speak(text: string, style: string, outFile: string) {
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
          input: `Đọc nguyên văn đoạn sau bằng ${style}. Không thêm, không bớt chữ nào:\n\n${text}`,
          response_modalities: ["audio"],
          generation_config: { speech_config: [{ voice: VOICE, language: "vi-VN" }] },
        }),
      });
      const body = await res.json().catch(() => ({}));
      const data = body?.steps?.flatMap((s: { content?: { data?: string }[] }) => s.content ?? []).find((c: { data?: string }) => c.data)?.data;
      if (res.ok && data) {
        void recordUsage(model, false);
        await writeFile(outFile, Buffer.from(data, "base64"));
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
