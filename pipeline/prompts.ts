import { z } from "zod";
import type { Chapter, Series } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import type { SeoTrendHints } from "@/lib/trends";

// Phong cách donghua 3D (hoạt hình tiên hiệp 3D Trung Quốc) — kiểu khán giả kênh tu tiên quen mắt.
const ART_STYLE =
  "Chinese 3D donghua CG animation still, xianxia cultivation world, premium 3D anime render, Unreal Engine 5, octane render, beautiful handsome characters with flawless detailed faces and long flowing hair, fully clothed in ornate layered hanfu robes with embroidery, glowing spiritual energy and qi aura, floating immortal mountains, sea of clouds, volumetric god rays, cinematic composition, depth of field, ultra detailed, 8k, no text, no watermark, no nudity";

const metaSchema = z.object({
  title: z.string().describe("Tiêu đề YouTube 50–70 ký tự (quá 70 bị cắt trên điện thoại): mở đầu bằng 1 từ khóa tìm kiếm thật điểm cao (vd 'Truyện tu tiên'), tiếp theo là móc câu gây tò mò về khoảnh khắc gay cấn nhất chương, cuối là tên truyện ngắn + số chương; viết hoa chữ cái đầu như câu thường (KHÔNG in hoa toàn bộ)"),
  titleAlternatives: z.array(z.string()).describe("2 phương án tiêu đề khác theo cùng yêu cầu, góc gây tò mò khác nhau"),
  description: z.string().describe("Mô tả 220–300 từ, chia 3–4 đoạn: câu đầu tiên chứa tên truyện; tóm tắt hấp dẫn không spoil kết; nhắc tên truyện ít nhất 2 lần và lồng tự nhiên ít nhất 1/3 số tag (không nhồi nhét); kêu gọi đăng ký/like/bật chuông; dòng cuối 3–5 hashtag"),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt và không dấu, tổng 300–480 ký tự; tag đầu tiên là từ khóa tìm kiếm thật điểm cao nhất, có tên truyện; trộn tag ngắn 1–2 từ và tag dài 3+ từ; không trùng nhau"),
  shortTitle: z.string().describe("Tiêu đề Short ≤ 60 ký tự, có tên nhân vật chính hoặc tên truyện, có #shorts"),
  shortDescription: z.string().describe("1–2 câu có tên truyện, mời xem video full trên kênh, kèm #shorts"),
  shortScript: z.string().describe("Lời đọc cho Short 90–130 từ: hook cực mạnh câu đầu, kể đoạn gay cấn nhất, dừng ở cao trào, câu cuối mời xem video full"),
  thumbnailText: z.string().describe("Chữ trên thumbnail 2–4 từ IN HOA, cảm xúc mạnh, KHÔNG lặp lại tiêu đề (vd 'NUỐT XÁC THẦN', 'MỘT ĐAO DIỆT TÔNG')"),
  thumbnailPrompt: z.string().describe("English image prompt for a YouTube thumbnail: extreme close-up of the main character's face and upper body at the most dramatic moment, intense emotion (rage, shock, cold killing intent), glowing eyes or energy, one clear focal point placed on the RIGHT half, darker simpler LEFT third for text, high contrast, saturated colors, strong rim light"),
  characterLook: z.string().describe("English: mô tả ngoại hình nhân vật chính để giữ nhất quán giữa các ảnh"),
});

/** System + prompt gửi AI — tách ra để màn flow hiện lại đúng thứ đã gửi. */
export function metaRequest(s: Series, c: Chapter, seo?: string | null, trends?: SeoTrendHints | null) {
  const keywords = seo
    ? `\n\nTừ khóa người xem Việt Nam tìm thật trên YouTube (vidIQ, xếp theo điểm — điểm cao = nhiều lượt tìm, ít cạnh tranh). Tiêu đề PHẢI chứa 1 từ khóa top đầu; đoạn đầu mô tả và tag đầu dùng từ khóa điểm cao; không nhồi nhét:\n${seo}`
    : "";
  // Xu hướng hiện tại của ngách (vidIQ): tham khảo, không bắt chước nguyên văn.
  const trendNote = trends
    ? `\n\nXu hướng đang ăn view của ngách (tham khảo cách đặt, KHÔNG sao chép nguyên văn):${trends.titlePatterns.length ? `\n- Mẫu tiêu đề: ${trends.titlePatterns.join(" | ")}` : ""}${trends.thumbnailPatterns.length ? `\n- Mẫu thumbnail: ${trends.thumbnailPatterns.join(" | ")}` : ""}`
    : "";
  return {
    system: "Bạn là chuyên gia YouTube kênh truyện audio tiên hiệp Việt Nam, tối ưu CTR và retention.",
    prompt: `Truyện: ${s.title}\nCốt truyện: ${s.premise}\nNhân vật/bối cảnh:\n${s.bible.slice(0, 3000)}\n\nChương ${c.number}: ${c.title}\n${c.content}${keywords}${trendNote}`,
  };
}

export async function videoMeta(s: Series, c: Chapter, seo?: string | null, trends?: SeoTrendHints | null) {
  return textProvider().generateJson({
    ...metaRequest(s, c, seo, trends),
    schema: metaSchema,
    temperature: 0.8,
    // Tiêu đề/mô tả quyết định lượt bấm → dùng model tốt (Gemini: danh sách quality, không phải flash-lite).
    tier: "quality",
    task: "meta",
  });
}

export function scenesRequest(characterLook: string, scenes: string[]) {
  return {
    system: "You write prompts for an image model illustrating a Chinese xianxia audio story.",
    prompt: `Main character look (keep consistent): ${characterLook}

For EACH numbered scene below write one vivid English image prompt (subject, dynamic pose, setting, mood, cinematic camera angle) and mark action=true if the scene is a fight, chase, explosion, technique release or other intense moment. Exactly ${scenes.length} items, same order.

${scenes.map((t, i) => `${i + 1}. ${t.slice(0, 600)}`).join("\n\n")}`,
  };
}

/** Một prompt ảnh (tiếng Anh) cho mỗi phân cảnh, theo đúng thứ tự. */
export async function scenePrompts(characterLook: string, scenes: string[]) {
  const { scenes: out } = await textProvider().generateJson({
    ...scenesRequest(characterLook, scenes),
    schema: z.object({ scenes: z.array(z.object({ prompt: z.string(), action: z.boolean() })) }),
    temperature: 0.7,
    tier: "cheap",
    task: "scenes",
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
