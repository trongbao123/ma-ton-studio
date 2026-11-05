import { z } from "zod";
import type { Chapter, Series } from "@/db/schema";

/** Số chương gần nhất đưa nguyên tóm tắt vào prompt; xa hơn thì bỏ để prompt không phình. */
export const RECENT_SUMMARY_WINDOW = 15;

const WRITER_SYSTEM = `Bạn là tác giả truyện mạng tiếng Việt chuyên thể loại tiên hiệp, huyền huyễn, ma đạo.
Truyện dùng để đọc thành audio trên YouTube, nên:
- Văn trôi chảy khi đọc to, câu không quá dài, tránh ký hiệu, chú thích, bảng, markdown.
- Mở chương bằng hook gây tò mò trong 2–3 câu đầu; kết chương bằng tình huống treo (cliffhanger).
- Nhịp nhanh, nhiều xung đột, nhân vật chính có mục tiêu rõ; thoại tự nhiên.
- Giữ đúng tên, cảnh giới, thế lực trong story bible. Không mâu thuẫn với các chương trước.
- Nội dung do bạn tự sáng tác, không chép truyện đã xuất bản.`;

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

Yêu cầu story bible chi tiết, đủ để nhiều chương sau viết nhất quán. Hệ thống cảnh giới phải có thứ tự rõ ràng.`,
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
Mỗi chương phải đẩy truyện tiến lên, có ít nhất một cao trào nhỏ; cứ vài chương có một bước ngoặt lớn.`,
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
