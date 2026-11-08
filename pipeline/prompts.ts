import { z } from "zod";
import type { Chapter, Series } from "@/db/schema";
import { textProvider } from "@/lib/ai";

// Phong cách donghua 3D (hoạt hình tiên hiệp 3D Trung Quốc) — kiểu khán giả kênh tu tiên quen mắt.
const ART_STYLE =
  "Chinese 3D donghua CG animation still, xianxia cultivation world, premium 3D anime render, Unreal Engine 5, octane render, beautiful handsome characters with flawless detailed faces and long flowing hair, fully clothed in ornate layered hanfu robes with embroidery, glowing spiritual energy and qi aura, floating immortal mountains, sea of clouds, volumetric god rays, cinematic composition, depth of field, ultra detailed, 8k, no text, no watermark, no nudity";

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
  const { scenes: out } = await textProvider().generateJson({
    system: "You write prompts for an image model illustrating a Chinese xianxia audio story.",
    prompt: `Main character look (keep consistent): ${characterLook}

For EACH numbered scene below write one vivid English image prompt (subject, dynamic pose, setting, mood, cinematic camera angle) and mark action=true if the scene is a fight, chase, explosion, technique release or other intense moment. Exactly ${scenes.length} items, same order.

${scenes.map((t, i) => `${i + 1}. ${t.slice(0, 600)}`).join("\n\n")}`,
    schema: z.object({ scenes: z.array(z.object({ prompt: z.string(), action: z.boolean() })) }),
    temperature: 0.7,
    tier: "cheap",
  });
  const pick = (i: number) => out[i] ?? out[i % Math.max(out.length, 1)];
  return scenes.map((_, i) => {
    const sc = pick(i);
    return {
      prompt: `${sc?.prompt ?? characterLook}, ${sc?.action ? "dynamic action shot, motion, glowing spiritual energy, sparks, " : ""}${ART_STYLE}`,
      action: Boolean(sc?.action),
    };
  });
}

export { ART_STYLE };
