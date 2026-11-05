import { GoogleGenAI, HarmBlockThreshold, HarmCategory, type GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import type { JsonRequest, TextProvider, TextRequest } from "./types";

/** Truyện tiên hiệp có đánh nhau, chết chóc — chỉ chặn mức nghiêm trọng để không bị cắt ngang chương. */
const FICTION_SAFETY = [
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH }));

export class GeminiProvider implements TextProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
  ) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generateText(req: TextRequest): Promise<string> {
    return this.call(req, {});
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const raw = await this.call(req, {
      responseMimeType: "application/json",
      responseJsonSchema: z.toJSONSchema(req.schema),
    });
    return req.schema.parse(JSON.parse(raw));
  }

  private async call(req: TextRequest, extra: GenerateContentConfig): Promise<string> {
    const res = await this.client.models.generateContent({
      model: this.model,
      contents: req.prompt,
      config: {
        systemInstruction: req.system,
        maxOutputTokens: req.maxOutputTokens,
        temperature: req.temperature,
        safetySettings: FICTION_SAFETY,
        ...extra,
      },
    });
    const text = res.text?.trim();
    if (!text) {
      const reason = res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "không rõ";
      throw new Error(`Gemini không trả nội dung (lý do: ${reason}).`);
    }
    return text;
  }
}
