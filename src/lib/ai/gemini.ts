import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { JsonRequest, TextProvider, TextRequest } from "./types";
import { recordUsage } from "./usage";

/** Mọi model đã hết quota ngày — người gọi nên dừng và chờ lượt sau thay vì coi là lỗi. */
export class QuotaExhaustedError extends Error {}

type Format = { type: "text"; mime_type: "application/json"; schema: Record<string, unknown> };

/**
 * Gọi Gemini qua Interactions API (model mới không còn chạy qua generateContent).
 * Free tier: ~20 lượt/ngày cho cả họ flash, hay báo 503 → thử lần lượt từng model;
 * model đã hết quota ngày thì nhớ lại và bỏ qua trong cả tiến trình.
 */
export class GeminiProvider implements TextProvider {
  readonly name = "gemini";
  lastModel?: string;
  private readonly client: GoogleGenAI;

  private readonly exhausted = new Set<string>();

  constructor(
    apiKey: string,
    private readonly models: Record<"quality" | "cheap", string[]>,
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
    for (const model of this.models[req.tier ?? "quality"].filter((m) => !this.exhausted.has(m))) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await this.client.interactions.create({
            model,
            input: req.prompt,
            system_instruction: req.system,
            generation_config: { max_output_tokens: req.maxOutputTokens, temperature: req.temperature },
            ...(format && { response_format: format }),
          });
          void recordUsage(model, false);
          const text = res.output_text?.trim();
          if (text) {
            this.lastModel = model;
            return text;
          }
          lastError = new Error(`${model} trả về rỗng.`);
        } catch (e) {
          lastError = e;
          if (isDailyLimit(e)) {
            this.exhausted.add(model);
            void recordUsage(model, true);
            break;
          }
          if (!isOverloaded(e)) throw e;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    if (isDailyLimit(lastError) || this.models[req.tier ?? "quality"].every((m) => this.exhausted.has(m))) {
      throw new QuotaExhaustedError(`Hết lượt AI free hôm nay — tự chạy tiếp khi quota reset. (${detail})`);
    }
    throw new Error(`Gemini quá tải, thử lại sau. (${detail})`);
  }
}

function isDailyLimit(e: unknown) {
  return /per day/i.test(e instanceof Error ? e.message : String(e));
}

function isOverloaded(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /503|429|high demand|service_unavailable|overloaded|rate/i.test(msg);
}
