import { z } from "zod";
import type { VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { scoreMeta, SEO_TARGET, seoFeedback, totalScore } from "@/lib/flow/seo";

/** Dòng ghi chú AI luôn nằm cuối mô tả (pipeline thêm vào) — tách ra khi đưa AI sửa, gắn lại sau. */
export const AI_NOTE = "(Nội dung có sử dụng AI hỗ trợ giọng đọc và hình ảnh.)";
export { SEO_TARGET };

const fixSchema = z.object({
  title: z.string().describe("Tiêu đề YouTube 50–70 ký tự: có 1 từ khóa tìm kiếm thật (vd 'Truyện tu tiên'), móc câu gây tò mò, tên truyện, số chương; không in hoa toàn bộ"),
  description: z.string().describe("Mô tả 220–300 từ, 3–4 đoạn, câu đầu có tên truyện, nhắc tên truyện ≥ 2 lần, lồng ≥ 1/3 số tag, kêu gọi đăng ký/like, dòng cuối 3–5 hashtag"),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt CÓ DẤU (không viết kiểu 'truyen tu tien'), ≥ 5 tag lấy nguyên văn từ khóa vidIQ, tổng 300–480 ký tự, tag đầu là từ khóa tìm kiếm điểm cao nhất, có tên truyện, có tag ngắn và tag dài, không trùng"),
  shortTitle: z.string().describe("Tiêu đề Short ≤ 60 ký tự, có tên nhân vật hoặc tên truyện, có #shorts"),
  shortDescription: z.string().describe("1–2 câu có tên truyện, mời xem video full, kèm #shorts"),
});

type Ctx = { seriesTitle: string; chapterNumber: number; chapterTitle: string; summary?: string };

const strip = (d: string) => d.replace(AI_NOTE, "").trim();
const withNote = (d: string) => `${strip(d)}\n\n${AI_NOTE}`;

/**
 * "Magic fill": điểm SEO tổng dưới mục tiêu thì đưa AI sửa đúng các tiêu chí đang mất điểm, chấm lại, lặp tối đa `rounds` lượt.
 * Chỉ nhận bản mới khi điểm tăng; giữ bản tốt nhất. Tiêu đề có điểm vidIQ thì giữ nguyên.
 */
export async function optimizeMeta(meta: VideoMeta, ctx: Ctx, opts: { target?: number; rounds?: number; log?: (s: string) => void } = {}) {
  const target = opts.target ?? SEO_TARGET;
  let best = meta;
  let bestScore = totalScore(scoreMeta(best, ctx.seriesTitle));
  const start = bestScore;
  let used = 0;
  // Tiêu đề do vidIQ chấm/chọn (điểm CTR thật) thì khoá lại, chỉ sửa mô tả / tag / Short.
  // Tiêu đề thiếu từ khóa người ta tìm thật thì không khoá — để AI gắn từ khóa vào.
  const search = meta.seo?.keywords?.slice(0, 8) ?? [];
  const lockTitle = meta.seo?.titleScore != null && (!search.length || scoreMeta(meta, ctx.seriesTitle).title.checks.every((c) => !c.text.startsWith("Thiếu từ khóa tìm kiếm thật")));
  for (let i = 0; i < (opts.rounds ?? 3) && bestScore < target; i++) {
    used++;
    const scores = scoreMeta(best, ctx.seriesTitle);
    let out: z.infer<typeof fixSchema>;
    try {
      out = await textProvider().generateJson({
        system: "Bạn là chuyên gia SEO YouTube cho kênh truyện audio tiên hiệp Việt Nam. Sửa metadata để đạt điểm SEO cao mà vẫn tự nhiên, hấp dẫn, không nhồi nhét, không spoil kết chương.",
        prompt: `Truyện: ${ctx.seriesTitle}
Chương ${ctx.chapterNumber}: ${ctx.chapterTitle}${ctx.summary ? `\nTóm tắt chương: ${ctx.summary.slice(0, 1500)}` : ""}

${best.seo?.keywords?.length ? `Từ khóa người xem tìm thật (vidIQ, Việt Nam, xếp theo điểm): ${best.seo.keywords.slice(0, 10).join(", ")}\n\n` : ""}Metadata hiện tại (điểm SEO tổng ${bestScore}/100, cần ≥ ${target}):
${JSON.stringify({ title: best.title, description: strip(best.description), tags: best.tags, shortTitle: best.shortTitle, shortDescription: best.shortDescription }, null, 1)}

Các tiêu chí đang mất điểm — sửa đúng những điểm này, phần đã đạt thì giữ:
${seoFeedback(scores)}

Giữ nguyên nội dung câu chuyện và tên nhân vật.${lockTitle ? " Tiêu đề đã được vidIQ chọn — GIỮ NGUYÊN tiêu đề, chỉ sửa mô tả, tag và Short." : ""} Trả về đủ 5 trường.`,
        schema: fixSchema,
        temperature: 0.6,
        tier: "quality",
        task: "meta",
      });
    } catch (e) {
      if (e instanceof QuotaExhaustedError) throw e;
      opts.log?.(`SEO: lượt ${i + 1} lỗi — ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      break;
    }
    const next: VideoMeta = {
      ...best,
      title: lockTitle ? best.title : out.title.length > 100 ? `${out.title.slice(0, 97)}…` : out.title,
      description: withNote(out.description),
      tags: out.tags,
      shortTitle: out.shortTitle,
      shortDescription: out.shortDescription,
    };
    if (next.title !== best.title && next.seo) next.seo = { ...next.seo, titleScore: null };
    const score = totalScore(scoreMeta(next, ctx.seriesTitle));
    opts.log?.(`SEO lượt ${i + 1}: ${bestScore} → ${score}${score > bestScore ? "" : " (giữ bản cũ)"}`);
    if (score > bestScore) {
      best = next;
      bestScore = score;
    }
  }
  return { meta: best, from: start, score: bestScore, rounds: used };
}
