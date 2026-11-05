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
      // Thứ tự ưu tiên, cách nhau bằng dấu phẩy. Model đầu quá tải thì chuyển model sau.
      const models = (process.env.GEMINI_MODELS ?? "gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash").split(",");
      return new GeminiProvider(key, models.map((m) => m.trim()).filter(Boolean));
    }
    default:
      throw new Error(`TEXT_PROVIDER "${name}" chưa được hỗ trợ.`);
  }
}
