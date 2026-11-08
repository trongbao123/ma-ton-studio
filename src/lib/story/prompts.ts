import { z } from "zod";
import type { Chapter, Series } from "@/db/schema";

/** Số chương gần nhất đưa nguyên tóm tắt vào prompt; xa hơn thì bỏ để prompt không phình. */
export const RECENT_SUMMARY_WINDOW = 15;

const WRITER_SYSTEM = `Bạn là tác giả truyện mạng tiếng Việt top đầu, chuyên huyền huyễn, tiên hiệp, ma đạo — lối viết gây nghiện học từ Đấu La Đại Lục 3 (Long Vương Truyền Thuyết), Quang Âm Chi Ngoại và Thôn Phệ Tinh Không: thế giới tu tiên rộng lớn tàn khốc, nhân vật chính lý trí quyết đoán, mạnh lên từng bước có số đo rõ ràng, trận chiến hoành tráng, bí ẩn lớn hé dần.
Truyện dùng để đọc thành audio trên YouTube, người nghe bỏ đi nếu chán 10 giây, nên:
- 2–3 câu đầu là hook mạnh: nguy hiểm, nhục nhã, bí ẩn hoặc một lời tuyên bố gây sốc. Không mở bằng tả cảnh dài.
- Mỗi chương phải có ít nhất một "điểm sướng": thăng cấp, vả mặt kẻ khinh thường, lộ bí mật, đoạt bảo vật, thắng trận trước mặt đám đông.
- Sức mạnh đo được bằng con số và cấp bậc rõ (cảnh giới gì, tầng mấy, pháp bảo phẩm gì); người nghe phải thấy nhân vật mạnh lên từng chút.
- Chiêu thức có tên riêng kêu, mô tả bằng âm thanh, ánh sáng, cảm giác; trận đấu có phản đòn, lật kèo, cái giá phải trả.
- Phản ứng đám đông: kinh ngạc, hít khí lạnh, im phăng phắc — để khuếch đại khoảnh khắc nhân vật chính toả sáng.
- Nhiều thoại ngắn sắc, có cá tính; xen suy nghĩ nội tâm của nhân vật chính. Có tình huynh đệ, đồng đội, tình cảm, mối thù để người nghe gắn bó.
- Giọng kể lôi cuốn như người kể chuyện đang hào hứng, xen chút dí dỏm cho nhẹ nhàng; nhân vật chính bình tĩnh, mưu trí, ra tay quyết đoán, thoại ngắn sắc; lúc đánh nhau và lúc cảm động thì nghiêm túc, căng thẳng.
- Tạo kích thích liên tục: úp mở bí mật, đặt câu hỏi cho người nghe ("Các vị đoán xem, hắn đã làm gì?"), đẩy nguy hiểm lên rồi mới lật kèo.
- Câu ngắn, nhịp nhanh, dễ đọc to; không ký hiệu, chú thích, bảng, markdown.
- Kết chương bằng cliffhanger buộc người nghe bấm chương sau.
- Giữ đúng tên, cấp bậc, thế lực trong story bible; không mâu thuẫn chương trước.
- Tự sáng tác hoàn toàn: được dùng mô-típ của thể loại nhưng KHÔNG dùng tên nhân vật, địa danh, tông môn hay tình tiết riêng của truyện đã xuất bản.`;

export const bibleSchema = z.object({
  title: z.string().describe("Tên truyện hấp dẫn, 3–8 chữ"),
  premise: z.string().describe("Tóm tắt cốt truyện 3–5 câu"),
  bible: z
    .string()
    .describe("Story bible: nhân vật chính/phụ/phản diện, hệ thống cảnh giới, thế lực, bối cảnh, tuyến truyện lớn"),
  style: z.string().describe("Giọng văn, ngôi kể, nhịp truyện"),
});
export type BibleDraft = z.infer<typeof bibleSchema>;

export function biblePrompt(idea: string, genre: string) {
  return {
    system: WRITER_SYSTEM,
    prompt: `Thiết kế một bộ truyện ${genre} dài kỳ (100+ chương) từ ý tưởng sau:
"${idea}"

Story bible chi tiết, đủ để nhiều chương sau viết nhất quán, gồm:
- Hệ thống TU TIÊN có cảnh giới rõ thứ tự (vd Luyện Khí 1–9 tầng, Trúc Cơ, Kim Đan, Nguyên Anh, Hóa Thần…), mỗi cảnh giới có dấu hiệu đột phá, thọ nguyên, thần thông đặc trưng; pháp bảo, đan dược, công pháp có phẩm cấp.
- "Bàn tay vàng" của nhân vật chính: bí mật thân thế hoặc năng lực độc nhất, hé lộ dần theo từng arc.
- Nhóm đồng đội 4–6 người cá tính khác nhau, đối thủ cùng thế hệ, phản diện lớn phía sau.
- Các arc lớn nối tiếp, thế giới mở rộng dần (thôn nhỏ → tông môn → châu lục → thượng giới/tinh không), mỗi arc có mục tiêu, bí cảnh, trùm cuối.`,
  };
}

export const outlineSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string(),
        outline: z.string().describe("Dàn ý 4–8 gạch đầu dòng: diễn biến chính, xung đột, cliffhanger cuối chương"),
      }),
    )
    .min(1),
});
export type OutlineDraft = z.infer<typeof outlineSchema>;

export function outlinePrompt(s: Series, previous: Chapter[], count: number) {
  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  return {
    system: WRITER_SYSTEM,
    prompt: `${storyContext(s, previous)}

Lên dàn ý cho ${count} chương tiếp theo, từ chương ${startAt} đến chương ${startAt + count - 1}.
Mỗi chương đẩy truyện tiến lên, có ít nhất một điểm sướng (thăng cấp, vả mặt, đoạt bảo, thắng trận); cứ 3–5 chương có một bước ngoặt lớn hoặc trận đấu cao trào. Ghi rõ trong dàn ý cấp bậc nhân vật chính thay đổi thế nào.`,
  };
}

export function chapterPrompt(s: Series, previous: Chapter[], chapter: Chapter) {
  return {
    system: `${WRITER_SYSTEM}\nGiọng văn của bộ này: ${s.style || "kể ngôi thứ ba, nhịp nhanh"}.`,
    prompt: `${storyContext(s, previous)}

Viết chương ${chapter.number}: "${chapter.title}".
Dàn ý:
${chapter.outline}

Độ dài khoảng ${s.targetWords} từ. Chỉ trả về nội dung chương, không lặp lại tiêu đề, không lời bình.`,
  };
}

export function continuePrompt(base: { system: string; prompt: string }, written: string, targetWords: number) {
  return {
    system: base.system,
    prompt: `${base.prompt}

# Phần đã viết (${wordCount(written)} từ)
${written}

Chương còn quá ngắn. Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${targetWords - wordCount(written)} từ, đi hết dàn ý và kết bằng cliffhanger. Không lặp lại đoạn đã viết, không tóm tắt.`,
  };
}

export function wordCount(text: string) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function summaryPrompt(chapter: Pick<Chapter, "number" | "title">, content: string) {
  return {
    system: "Bạn tóm tắt chương truyện để làm trí nhớ cho tác giả viết các chương sau.",
    prompt: `Tóm tắt chương ${chapter.number} "${chapter.title}" trong 4–6 câu. Ghi rõ: sự kiện chính, nhân vật mới, thay đổi cảnh giới/vật phẩm, tình huống treo cuối chương.

${content}`,
  };
}

/** Bối cảnh chung cho mọi prompt: bible + tóm tắt các chương đã viết gần nhất. */
export function storyContext(s: Series, previous: Chapter[]) {
  const recalled = previous
    .filter((c) => c.summary)
    .slice(-RECENT_SUMMARY_WINDOW)
    .map((c) => `Chương ${c.number} — ${c.title}: ${c.summary}`)
    .join("\n");

  return `# Truyện: ${s.title} (${s.genre})
Cốt truyện: ${s.premise}

# Story bible
${s.bible}

# Diễn biến đã viết
${recalled || "(Chưa có chương nào — đây là phần mở đầu.)"}`;
}
