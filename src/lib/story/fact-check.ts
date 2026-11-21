// Soát sự thật kịch bản lịch sử: một lượt AI riêng (khác lượt viết) đối chiếu mọi khẳng định với hồ sơ tư liệu,
// trả các câu không được ủng hộ kèm câu sửa → vá chuỗi → soát lại. Kênh không hư cấu: còn lỗi thì không render.
import { z } from "zod";
import type { TextProvider } from "@/lib/ai/types";
import type { FactIssue } from "./history-types";

/** Số vòng vá tối đa (tổng số lượt soát = 1 + số vòng vá). */
export const FACT_FIX_ROUNDS = 2;
/** Chỗ cho câu trả lời của lượt soát (gồm phần suy nghĩ của model). */
const FACT_CHECK_MAX_OUTPUT_TOKENS = 32_000;

export const factIssuesSchema = z.object({
  issues: z.array(
    z.object({
      quote: z.string(),
      verdict: z.enum(["khong-co", "mau-thuan"]),
      note: z.string(),
      fix: z.string(),
    }),
  ),
});

/** Kịch bản còn lỗi sự thật sau mọi vòng sửa — đề tài chuyển "chờ sửa", không render. */
export class FactCheckFailedError extends Error {
  constructor(
    message: string,
    readonly issues: FactIssue[],
  ) {
    super(message);
  }
}

/** Prompt soát: chỉ trả các câu KHÔNG được hồ sơ ủng hộ hoặc mâu thuẫn, kèm câu sửa theo hồ sơ. */
export function factCheckPrompt(script: string, dossierText: string) {
  return {
    system: `Bạn là biên tập viên kiểm chứng lịch sử, khó tính và chính xác. Bạn KHÔNG viết lại văn, chỉ bắt lỗi sự thật so với hồ sơ tư liệu được đưa.`,
    prompt: `HỒ SƠ TƯ LIỆU (chuẩn duy nhất):
<ho_so>
${dossierText}
</ho_so>

KỊCH BẢN CẦN SOÁT:
<kich_ban>
${script}
</kich_ban>

Duyệt MỌI câu có: năm/ngày tháng, tên người, tên địa danh, con số (quân số, thương vong, khoảng cách), câu trích dẫn trong ngoặc kép, quan hệ nhân quả ("vì… nên…"), kết cục.
Trả về issues = CHỈ những câu:
- "khong-co": hồ sơ không có chi tiết đó (kể cả chi tiết nghe hợp lý), hoặc câu trích dẫn không có nguyên văn trong hồ sơ;
- "mau-thuan": hồ sơ nói khác.
Với mỗi lỗi:
- quote: copy NGUYÊN VĂN một đoạn ngắn LIÊN TỤC trong kịch bản chứa lỗi (đủ để tìm thấy duy nhất, không sửa dấu câu);
- note: hồ sơ nói gì (ngắn);
- fix: đoạn thay thế cho đúng quote, đúng theo hồ sơ, giữ giọng kể; nếu không có cách nói đúng thì "" (xoá đoạn đó).
LỜI KỂ KHÔNG ĐƯỢC NÊU TÊN NGUỒN TRA CỨU: câu nào nhắc Wikipedia, bách khoa, "hồ sơ", "tư liệu", tên trang web/tạp chí/báo → lỗi "khong-co", fix = chính câu đó kể thẳng sự kiện, bỏ phần nêu nguồn ("Theo Wikipedia tiếng Anh, quân Thanh mất 3 ngày" → "Quân Thanh mất 3 ngày"). Nêu tên sử liệu gốc / sử gia (Đại Việt sử ký toàn thư, Herodotus…) thì được. Câu kể chuyện các nguồn vênh nhau ở chi tiết vặt (ngày lệch 1–2 hôm, cách phân công) → lỗi, fix = kể theo một bản hoặc bỏ.
THỨ BẬC NGUỒN (đầu mỗi mục hồ sơ ghi loại): sử liệu gốc (wikisource) và bách khoa (wikipedia, Britannica) tin hơn báo (web). Khi hai nguồn trong hồ sơ ghi khác nhau mà kịch bản NÓI RÕ cả hai ("sử chép…, nhưng có ý kiến…") thì câu đó ĐÚNG — không bắt lỗi, không "sửa" về một bên. Kịch bản chỉ theo một nguồn mà nguồn tin hơn nói khác → "mau-thuan", fix theo nguồn tin hơn hoặc nói rõ cả hai.
BỎ QUA câu tả không khí chung không gắn số liệu/tên (gió, sông nước, "trận chiến khốc liệt"). Trả tối đa 40 lỗi quan trọng nhất (sai năm/tên/số/kết cục trước); vòng soát sau sẽ bắt tiếp phần còn lại. Không có lỗi thì issues = [].`,
  };
}

/** Tên nguồn tra cứu không được xuất hiện trong lời kể (sử liệu gốc / sử gia thì được). */
const REFERENCE_MENTION = /wikipedia|bách khoa|hồ sơ|tư liệu|tài liệu tham khảo|britannica|world history|history\.com|national geographic|smithsonian|vnexpress|báo tuổi trẻ|báo thanh niên|nghiên cứu lịch sử|tạp chí/i;

/** Câu trong kịch bản nêu tên nguồn tra cứu — lớp kiểm bằng code sau lượt soát AI (AI có thể bỏ sót). */
export function referenceMentionIssues(script: string): FactIssue[] {
  const sentences = script.match(/[^.!?…\n]+[.!?…]*/g) ?? [];
  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => REFERENCE_MENTION.test(sentence))
    .map((quote) => ({ quote, verdict: "khong-co" as const, note: "Lời kể nêu tên nguồn tra cứu (Wikipedia/hồ sơ/trang web) — kể thẳng sự kiện.", fix: "" }));
}

/** Thay lần xuất hiện đầu của mỗi `quote` bằng `fix` (rỗng = xoá); quote không có trong kịch bản thì bỏ qua. */
export function applyFactFixes(script: string, issues: FactIssue[]): string {
  let patched = script;
  for (const { quote, fix } of issues) {
    if (!quote || !patched.includes(quote)) continue;
    patched = patched.replace(quote, fix);
  }
  return patched.replace(/ {2,}/g, " ").replace(/ +([.,;:!?])/g, "$1");
}

/** Soát → vá → soát lại (tối đa FACT_FIX_ROUNDS vòng vá). Trả kịch bản cuối + lỗi còn lại (rỗng = đạt). */
export async function factCheckScript(ai: TextProvider, script: string, dossierText: string): Promise<{ script: string; issues: FactIssue[] }> {
  let current = script;
  for (let round = 0; ; round++) {
    const { issues } = await ai.generateJson({
      ...factCheckPrompt(current, dossierText),
      schema: factIssuesSchema,
      temperature: 0,
      task: "story",
      // Model có suy nghĩ tính cả phần suy nghĩ vào giới hạn này — 8k từng làm JSON bị cắt giữa chừng.
      maxOutputTokens: FACT_CHECK_MAX_OUTPUT_TOKENS,
    });
    if (!issues.length || round >= FACT_FIX_ROUNDS) {
      // AI có thể bỏ sót câu nêu tên Wikipedia/hồ sơ — còn sót thì giữ thành lỗi (đề tài "chờ sửa", không render).
      const leftover = referenceMentionIssues(current).filter((m) => !issues.some((i) => i.quote.includes(m.quote) || m.quote.includes(i.quote)));
      return { script: current, issues: [...issues, ...leftover] };
    }
    current = applyFactFixes(current, issues);
  }
}
