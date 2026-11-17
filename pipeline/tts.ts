import { access, writeFile } from "node:fs/promises";
import { QuotaExhaustedError } from "@/lib/ai";
import { recordUsage } from "@/lib/ai/usage";

const MODELS = (process.env.TTS_MODELS ?? "gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts,gemini-3.8-flash-lite-tts").split(",");

/**
 * Đọc một khối văn bản bằng Gemini TTS, ghi WAV (24kHz mono). Thử lần lượt model khi quá tải/hết quota.
 * Free tier: gemini-3.8-flash-tts chỉ 10 lượt/ngày — các model sau là dự phòng.
 */
export async function speak(text: string, outFile: string, voice = process.env.TTS_VOICE ?? "Algenib") {
  // Model TTS không nhận system instruction → chất giọng giữ bằng `voice` (chọn theo bộ truyện).
  // Chỉ gửi đúng văn bản truyện: kèm câu hướng dẫn thì model đôi khi đọc luôn câu đó.
  return synth(outFile, text, [{ voice, language: "vi-VN" }]);
}

/** Một lượt đọc có người nói + cảm xúc (speech_metadata) — văn bản được chèn thẻ hơi thở <sigh>… */
export type SpeechTurn = { speaker: string; voice: string; style: string; text: string };

/** Lỗi định dạng (400) của kiểu gọi nhiều giọng — người gọi quay về đọc một giọng. */
export class SpeechFormatError extends Error {}

/**
 * Đọc nhiều lượt trong MỘT lượt gọi: 1 giọng → speech_config mảng; 2 giọng → { speakers }. Cảm xúc từng lượt ở
 * annotations speech_metadata.style (không bị đọc thành tiếng). Gemini cho tối đa 2 giọng / lượt gọi.
 */
export async function speakTurns(turns: SpeechTurn[], outFile: string) {
  const voices = [...new Set(turns.map((t) => t.voice))];
  if (voices.length > 2) throw new Error("Tối đa 2 giọng mỗi lượt đọc");
  const multi = voices.length === 2;
  const input = [
    {
      type: "user_input",
      content: turns.map((t) => ({
        type: "text",
        text: t.text,
        // Nhiều giọng: tên speaker = tên giọng (map 1–1 trong speech_config).
        annotations: [{ type: "speech_metadata", ...(multi ? { speaker: t.voice } : {}), ...(t.style ? { style: t.style } : {}) }],
      })),
    },
  ];
  const config = multi ? { speakers: voices.map((v) => ({ speaker: v, voice: v })) } : [{ voice: voices[0], language: "vi-VN" }];
  return synth(outFile, input, config, true);
}

async function synth(outFile: string, input: unknown, speechConfig: unknown, structured = false) {
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
          input,
          response_modalities: ["audio"],
          generation_config: { speech_config: speechConfig },
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
      // Kiểu nhiều lượt/nhiều giọng bị từ chối định dạng → báo người gọi đọc lại một giọng (không thử model khác vô ích).
      if (structured && res.status === 400) throw new SpeechFormatError(last);
      if (res.status !== 429 && res.status < 500) break;
      await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
    }
  }
  // Có model chạm giới hạn ngày (các model còn lại lỗi khác) → vẫn coi là hết quota để video quay về hàng đợi, không báo "lỗi".
  if (limited > 0) throw new QuotaExhaustedError(`Hết lượt giọng đọc free hôm nay. (${last})`);
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
