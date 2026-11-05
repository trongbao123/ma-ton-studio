import { z } from "zod";
import type { Chapter, Series } from "@/db/schema";
import { textProvider } from "@/lib/ai";

const ART_STYLE =
  "chinese xianxia fantasy, ancient china, cinematic lighting, dramatic composition, highly detailed digital painting, dark crimson and black palette, epic atmosphere, no text, no watermark";

const metaSchema = z.object({
  title: z.string().describe("Tiêu đề YouTube 60–90 ký tự, viết hoa chữ cái đầu như câu thường (KHÔNG in hoa toàn bộ), gây tò mò, có tên truyện và số chương"),
  description: z.string().describe("Mô tả 3 đoạn: tóm tắt hấp dẫn không spoil kết, kêu gọi đăng ký/like, hashtag"),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt và không dấu"),
  shortTitle: z.string().describe("Tiêu đề Short ≤ 70 ký tự, có #shorts"),
  shortDescription: z.string(),
  shortScript: z.string().describe("Lời đọc cho Short 90–130 từ: hook cực mạnh câu đầu, kể đoạn gay cấn nhất, dừng ở cao trào, câu cuối mời xem video full"),
  thumbnailText: z.string().describe("Chữ trên thumbnail, 2–5 từ IN HOA, giật gân"),
  thumbnailPrompt: z.string().describe("English image prompt cho thumbnail: cận cảnh nhân vật chính khoảnh khắc kịch tính nhất"),
  characterLook: z.string().describe("English: mô tả ngoại hình nhân vật chính để giữ nhất quán giữa các ảnh"),
});

export async function videoMeta(s: Series, c: Chapter) {
  return textProvider().generateJson({
    system: "Bạn là chuyên gia YouTube kênh truyện audio tiên hiệp Việt Nam, tối ưu CTR và retention.",
    prompt: `Truyện: ${s.title}\nCốt truyện: ${s.premise}\nNhân vật/bối cảnh:\n${s.bible.slice(0, 3000)}\n\nChương ${c.number}: ${c.title}\n${c.content}`,
    schema: metaSchema,
    temperature: 0.8,
    tier: "cheap",
  });
}

/** Một prompt ảnh (tiếng Anh) cho mỗi phân cảnh, theo đúng thứ tự. */
export async function scenePrompts(characterLook: string, scenes: string[]) {
  const { prompts } = await textProvider().generateJson({
    system: "You write prompts for an image model illustrating a Chinese xianxia audio story.",
    prompt: `Main character look (keep consistent): ${characterLook}

For EACH numbered scene below write one vivid English image prompt (subject, action, setting, mood). Exactly ${scenes.length} prompts, same order.

${scenes.map((t, i) => `${i + 1}. ${t.slice(0, 600)}`).join("\n\n")}`,
    schema: z.object({ prompts: z.array(z.string()) }),
    temperature: 0.7,
    tier: "cheap",
  });
  return scenes.map((_, i) => `${prompts[i] ?? prompts[i % Math.max(prompts.length, 1)] ?? characterLook}, ${ART_STYLE}`);
}

export { ART_STYLE };
