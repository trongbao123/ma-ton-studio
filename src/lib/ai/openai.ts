import OpenAI from "openai";
import { z } from "zod";
import { QuotaExhaustedError } from "./gemini";
import { recordUsage } from "./usage";
import type { JsonRequest, TextProvider, TextRequest } from "./types";

/**
 * ChatGPT qua OpenAI Responses API. Không gửi temperature: các model suy luận (GPT-5…) từ chối tham số này.
 * Hết tiền/hết quota (429 insufficient_quota) → QuotaExhaustedError để bộ định tuyến chuyển AI khác.
 */
export class OpenAIProvider implements TextProvider {
  readonly name = "openai";
  lastModel?: string;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  private async call(req: TextRequest, format?: { type: "json_schema"; name: string; schema: Record<string, unknown>; strict: false }) {
    try {
      const res = await this.client.responses.create({
        model: this.model,
        instructions: req.system,
        input: req.prompt,
        max_output_tokens: req.maxOutputTokens ?? 16000,
        reasoning: { effort: req.tier === "cheap" ? "low" : "medium" },
        ...(format && { text: { format } }),
      });
      const text = res.output_text?.trim();
      if (!text) throw new Error(`${this.model} trả về rỗng (${res.status}).`);
      void recordUsage(this.model, false);
      this.lastModel = this.model;
      return text;
    } catch (e) {
      if (e instanceof OpenAI.RateLimitError && /insufficient_quota|quota/i.test(e.message)) {
        void recordUsage(this.model, true);
        throw new QuotaExhaustedError(`OpenAI hết hạn mức/tiền: ${e.message}`);
      }
      throw e;
    }
  }

  generateText(req: TextRequest): Promise<string> {
    return this.call(req);
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const schema = z.toJSONSchema(req.schema) as Record<string, unknown>;
    const raw = await this.call(req, { type: "json_schema", name: "output", schema, strict: false });
    return req.schema.parse(JSON.parse(raw));
  }
}
