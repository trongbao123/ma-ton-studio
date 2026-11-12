// Biên tập viên AI: chấm 300 từ đầu chương theo OPENING_RULES ngay sau lượt viết đầu (trước các lượt "viết tiếp" và trước khi
// đọc giọng) — không đạt thì viết lại riêng phần mở đầu, tối đa MAX_REWRITES lần. Không bao giờ chặn pipeline: lỗi chấm thì giữ bản gốc.
import { z } from "zod";
import { QuotaExhaustedError } from "@/lib/ai/gemini";
import type { JsonRequest, TextRequest } from "@/lib/ai/types";
import { OPENING_RULES, wordCount } from "./prompts";

export const OPENING_WORDS = 300;
const MAX_REWRITES = 2;

type Prompt = { system: string; prompt: string };
export type Ai = { generateText(req: TextRequest): Promise<string>; generateJson<T>(req: JsonRequest<T>): Promise<T> };

/** Đoạn văn: ngăn bằng dòng trống; chương AI viết chỉ xuống dòng đơn thì tính mỗi dòng là một đoạn. */
const paragraphs = (content: string) => {
  const byBlank = content.split(/\n{2,}/);
  return byBlank.length > 1 ? byBlank : content.split(/\n/);
};

/** Gom các đoạn đầu tới khi đủ `words` từ; phần còn lại là thân chương (có thể rỗng). */
export function splitOpening(content: string, words = OPENING_WORDS) {
  const paras = paragraphs(content);
  let n = 0;
  let i = 0;
  while (i < paras.length && n < words) n += wordCount(paras[i++]);
  return { opening: paras.slice(0, i).join("\n\n").trim(), rest: paras.slice(i).join("\n\n").trim() };
}

/** "Mở đầu" dài quá mức này = không cắt được đoạn (cả chương một khối) → không viết lại, tránh thay cả chương bằng bản ngắn. */
const MAX_REWRITE_WORDS = OPENING_WORDS * 2;

export const reviewSchema = z.object({
  pass: z.boolean().describe("true nếu đạt TẤT CẢ luật"),
  failed: z.array(z.number().int()).describe("Số thứ tự (0-based) các luật KHÔNG đạt"),
  note: z.string().describe("1 câu: lỗi nặng nhất"),
});

export function reviewPrompt(opening: string): Prompt {
  return {
    system: "Bạn là biên tập viên khó tính của kênh truyện audio tu tiên trên YouTube. Bạn chấm xem đoạn mở đầu có giữ được người nghe trong 20 giây đầu không.",
    prompt: `Chấm đoạn mở đầu chương dưới đây theo từng luật (đánh số từ 0). Chỉ đạt khi đúng TẤT CẢ.\n\n${OPENING_RULES.map((r, i) => `${i}. ${r}`).join("\n")}\n\n# Đoạn mở đầu\n${opening}`,
  };
}

export function rewriteOpeningPrompt(base: Prompt, opening: string, failed: number[]): Prompt {
  const rules = failed.filter((i) => OPENING_RULES[i]).map((i) => `- ${OPENING_RULES[i]}`);
  return {
    system: base.system,
    prompt: `${base.prompt}\n\n# Đoạn mở đầu đã viết\n${opening}\n\nĐoạn mở đầu trên CHƯA đạt các luật sau:\n${rules.join("\n")}\n\nViết lại CHỈ đoạn mở đầu này: giữ nguyên diễn biến, nhân vật và chỗ dừng để nối tiếp được phần sau, độ dài tương đương (~${wordCount(opening)} từ), sửa đúng các lỗi trên. Chỉ trả về đoạn mở đầu mới, không viết tiếp, không lời bình.`,
  };
}

/** Ghép mở đầu mới với thân chương; AI lỡ chép luôn thân thì cắt phần chép đó đi. */
export function replaceOpening(content: string, newOpening: string) {
  const { rest } = splitOpening(content);
  let head = newOpening.trim();
  const firstRest = rest.split(/\n{2,}/)[0]?.trim();
  if (firstRest) {
    const at = head.indexOf(firstRest);
    if (at >= 0) head = head.slice(0, at).trim();
  }
  return rest ? `${head}\n\n${rest}` : head;
}

async function review(ai: Ai, opening: string) {
  return ai.generateJson({ ...reviewPrompt(opening), schema: reviewSchema, temperature: 0.2, tier: "cheap", task: "summary" });
}

export async function polishOpening(content: string, base: Prompt, ai: Ai): Promise<{ content: string; warning: string | null }> {
  if (!content.trim()) return { content, warning: null };
  let best = { content, failed: Number.POSITIVE_INFINITY, rules: [] as number[] };
  let current = content;
  try {
    for (let round = 0; ; round++) {
      const r = await review(ai, splitOpening(current).opening);
      if (r.pass) return { content: current, warning: null };
      if (r.failed.length < best.failed) best = { content: current, failed: r.failed.length, rules: r.failed };
      if (round === MAX_REWRITES || wordCount(splitOpening(current).opening) > MAX_REWRITE_WORDS) break;
      const fresh = await ai.generateText({ ...rewriteOpeningPrompt(base, splitOpening(current).opening, r.failed), maxOutputTokens: 4000, temperature: 0.8, task: "story" });
      current = replaceOpening(current, fresh);
    }
  } catch (e) {
    if (e instanceof QuotaExhaustedError) throw e;
    console.warn("⚠ Biên tập viên AI lỗi — giữ bản hiện có:", e instanceof Error ? e.message.slice(0, 200) : e);
    return { content: Number.isFinite(best.failed) ? best.content : current, warning: null };
  }
  const broken = best.rules.map((i) => OPENING_RULES[i]?.split(/[—;(]/)[0].trim()).filter(Boolean);
  return { content: best.content, warning: `Mở đầu chưa đạt (biên tập viên AI): ${broken.join(" | ")}` };
}
