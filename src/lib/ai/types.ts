import type { z } from "zod";
import type { AiTask } from "./routing";

export interface TextRequest {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** "quality" cho văn truyện, "cheap" cho việc phụ (tóm tắt, prompt ảnh, metadata) — để dành quota model tốt. */
  tier?: "quality" | "cheap";
  /** Việc gì — chọn chuỗi AI theo cài đặt. Bỏ trống: suy từ `tier` (quality → viết truyện, cheap → tóm tắt). */
  task?: AiTask;
}

export interface JsonRequest<T> extends TextRequest {
  schema: z.ZodType<T>;
}

/** Mọi nhà cung cấp LLM (và bộ định tuyến gộp chúng) đi qua interface này. */
export interface TextProvider {
  readonly name: string;
  /** Model trả lời lần gọi thành công gần nhất — màn flow hiện model thật đã chạy. */
  readonly lastModel?: string;
  generateText(req: TextRequest): Promise<string>;
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
}
