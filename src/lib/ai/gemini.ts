import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { JsonRequest, TextProvider, TextRequest } from "./types";

type Format = { type: "text"; mime_type: "application/json"; schema: Record<string, unknown> };

/**
 * Gọi Gemini qua Interactions API (model mới không còn chạy qua generateContent).
 * Free tier hay báo 503 "high demand" → thử lần lượt từng model trong danh sách.
 */
export class GeminiProvider implements TextProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly models: string[],
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateText(req: TextRequest): Promise<string> {
    return this.call(req);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const raw = await this.call(req, {
      type: "text",
      mime_type: "application/json",
      schema: z.toJSONSchema(req.schema) as Record<string, unknown>,
    });
    return req.schema.parse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
  }

  private async call(req: TextRequest, format?: Format): Promise<string> {
    let lastError: unknown;
    for (const model of this.models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await this.client.interactions.create({
            model,
            input: req.prompt,
            system_instruction: req.system,
            generation_config: { max_output_tokens: req.maxOutputTokens, temperature: req.temperature },
            ...(format && { response_format: format }),
          });
          const text = res.output_text?.trim();
          if (text) return text;
          lastError = new Error(`${model} trả về rỗng.`);
        } catch (e) {
          lastError = e;
          if (!isOverloaded(e)) throw e;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    throw new Error(`Gemini đang quá tải, thử lại sau. (${lastError instanceof Error ? lastError.message : lastError})`);
  }
}

function isOverloaded(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /503|429|high demand|service_unavailable|overloaded|rate/i.test(msg);
}
