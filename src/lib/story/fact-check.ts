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
BỎ QUA câu tả không khí chung không gắn số liệu/tên (gió, sông nước, "trận chiến khốc liệt"). Trả tối đa 40 lỗi quan trọng nhất (sai năm/tên/số/kết cục trước); vòng soát sau sẽ bắt tiếp phần còn lại. Không có lỗi thì issues = [].`,
  };
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
    if (!issues.length || round >= FACT_FIX_ROUNDS) return { script: current, issues };
    current = applyFactFixes(current, issues);
  }
}
