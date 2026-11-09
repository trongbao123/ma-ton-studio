import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { recordUsage } from "./usage";
import type { JsonRequest, TextProvider, TextRequest } from "./types";

/** Lỗi do model từ chối (stop_reason "refusal") — bộ định tuyến chuyển sang AI kế tiếp. */
export class RefusalError extends Error {}

/**
 * Claude qua Anthropic API. Nhiệt độ (temperature) không gửi: Claude Opus 5.5 trả 400 nếu có.
 * Viết truyện dùng effort cao hơn; việc phụ (tóm tắt, metadata, prompt ảnh) dùng effort thấp cho nhanh và rẻ.
 */
export class AnthropicProvider implements TextProvider {
  readonly name = "anthropic";
  lastModel?: string;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private effort(req: TextRequest) {
    return req.tier === "cheap" ? ("low" as const) : ("medium" as const);
  }

  async generateText(req: TextRequest): Promise<string> {
    // Chương truyện dài → stream để không vướng timeout HTTP; finalMessage() gom kết quả.
    const message = await this.client.messages
      .stream({
        model: this.model,
        max_tokens: req.maxOutputTokens ?? 16000,
        system: req.system,
        output_config: { effort: this.effort(req) },
        messages: [{ role: "user", content: req.prompt }],
      })
      .finalMessage();
    if (message.stop_reason === "refusal") throw new RefusalError(`${this.model} từ chối viết nội dung này.`);
    void recordUsage(this.model, false);
    const text = message.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    if (!text) throw new Error(`${this.model} trả về rỗng.`);
    this.lastModel = this.model;
    return text;
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const message = await this.client.messages.parse({
      model: this.model,
      max_tokens: req.maxOutputTokens ?? 16000,
      system: req.system,
      output_config: { effort: this.effort(req), format: zodOutputFormat(req.schema) },
      messages: [{ role: "user", content: req.prompt }],
    });
    if (message.stop_reason === "refusal") throw new RefusalError(`${this.model} từ chối yêu cầu này.`);
    if (!message.parsed_output) throw new Error(`${this.model} trả JSON không đúng khuôn.`);
    void recordUsage(this.model, false);
    this.lastModel = this.model;
    return req.schema.parse(message.parsed_output);
  }
}
