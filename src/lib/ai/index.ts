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
      return new GeminiProvider(key, process.env.GEMINI_MODEL ?? "gemini-2.5-flash");
    }
    default:
      throw new Error(`TEXT_PROVIDER "${name}" chưa được hỗ trợ.`);
  }
}
