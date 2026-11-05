import { GeminiProvider } from "./gemini";
import type { TextProvider } from "./types";

export type { TextProvider } from "./types";

let provider: TextProvider | undefined;

export function textProvider(): TextProvider {
  provider ??= createProvider(process.env.TEXT_PROVIDER ?? "gemini");
  return provider;
}

function createProvider(name: string): TextProvider {
  switch (name) {
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("Thiếu GEMINI_API_KEY — lấy free ở aistudio.google.com.");
      // Danh sách model theo thứ tự ưu tiên, cách nhau dấu phẩy. Model đầu hết lượt/quá tải thì chuyển model sau.
      const list = (v: string | undefined, d: string) => (v ?? d).split(",").map((m) => m.trim()).filter(Boolean);
      return new GeminiProvider(key, {
        quality: list(process.env.GEMINI_MODELS, "gemini-3.8-flash,gemini-3.6-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemma-4-31b-it"),
        cheap: list(process.env.GEMINI_CHEAP_MODELS, "gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemma-4-31b-it,gemini-3-flash-preview"),
      });
    }
    default:
      throw new Error(`TEXT_PROVIDER "${name}" chưa được hỗ trợ.`);
  }
}
