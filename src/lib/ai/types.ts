import type { z } from "zod";

export interface TextRequest {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** "quality" cho văn truyện, "cheap" cho việc phụ (tóm tắt, prompt ảnh, metadata) — để dành quota model tốt. */
  tier?: "quality" | "cheap";
}

export interface JsonRequest<T> extends TextRequest {
  schema: z.ZodType<T>;
}

/** Mọi nhà cung cấp LLM đi qua interface này — đổi provider chỉ cần đổi `TEXT_PROVIDER`. */
export interface TextProvider {
  readonly name: string;
  /** Model trả lời lần gọi thành công gần nhất — màn flow hiện model thật đã chạy. */
  readonly lastModel?: string;
  generateText(req: TextRequest): Promise<string>;
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
}
