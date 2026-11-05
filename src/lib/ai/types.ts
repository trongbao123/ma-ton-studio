import type { z } from "zod";

export interface TextRequest {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface JsonRequest<T> extends TextRequest {
  schema: z.ZodType<T>;
}

/** Mọi nhà cung cấp LLM đi qua interface này — đổi provider chỉ cần đổi `TEXT_PROVIDER`. */
export interface TextProvider {
  readonly name: string;
  generateText(req: TextRequest): Promise<string>;
  generateJson<T>(req: JsonRequest<T>): Promise<T>;
}
