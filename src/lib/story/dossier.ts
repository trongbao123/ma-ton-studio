// Hồ sơ tư liệu cho kênh lịch sử — điều phối các lớp nguồn (Wikipedia, sử liệu gốc Wikisource, web tin cậy).
// Kịch bản chỉ được dùng chi tiết trong hồ sơ; lượt soát sự thật đối chiếu với chính hồ sơ này.
import { MAIN_MAX_CHARS, wikipediaSources } from "./dossier-wikipedia";
import type { Dossier } from "./history-types";
import { realSleep, type Sleep } from "./wiki-api";

/** Trần ký tự mỗi bài Wikipedia chính (giữ tên cũ cho nơi đang dùng). */
export const DOSSIER_MAX_CHARS_PER_SOURCE = MAIN_MAX_CHARS;
/** Dưới ngần này ký tự (trang trống, trang định hướng) thì không đủ để viết mà không bịa. */
export const DOSSIER_MIN_CHARS = 3_000;

/** Gom hồ sơ cho đề tài theo bài Wikipedia tiếng Anh `wikiTitle`; hồ sơ quá mỏng → ném lỗi, không viết. */
export async function buildDossier(wikiTitle: string, sleep: Sleep = realSleep): Promise<Dossier> {
  const { main, related } = await wikipediaSources(wikiTitle, sleep);
  const sources = [...main, ...related];
  const totalChars = sources.reduce((n, s) => n + s.text.length, 0);
  if (totalChars < DOSSIER_MIN_CHARS)
    throw new Error(`Đề tài "${wikiTitle}" quá ít tư liệu (${totalChars} ký tự) — không viết từ hồ sơ gần như rỗng; đổi đề tài hoặc sửa dòng Wikipedia:.`);
  return { topic: wikiTitle, sources, fetchedAt: new Date().toISOString() };
}

/** Hồ sơ dạng văn bản để đưa vào prompt viết/soát. */
export function dossierText(d: Dossier): string {
  return d.sources.map((s) => `### ${s.lang} — ${s.title} (${s.url})\n${s.text}`).join("\n\n");
}
