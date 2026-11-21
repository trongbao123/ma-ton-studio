// Hồ sơ tư liệu cho kênh lịch sử — điều phối 3 lớp nguồn: Wikipedia (chính + liên quan), sử liệu gốc Wikisource,
// web tin cậy (Tavily). Kịch bản chỉ được dùng chi tiết trong hồ sơ; lượt soát sự thật đối chiếu với chính hồ sơ này.
import { MAIN_MAX_CHARS, wikipediaSources } from "./dossier-wikipedia";
import { wikisourceSources } from "./dossier-wikisource";
import { webSources } from "./dossier-web";
import type { Dossier, DossierSource } from "./history-types";
import { realSleep, type Sleep } from "./wiki-api";

/** Trần ký tự mỗi bài Wikipedia chính (giữ tên cũ cho nơi đang dùng). */
export const DOSSIER_MAX_CHARS_PER_SOURCE = MAIN_MAX_CHARS;
/** Dưới ngần này ký tự (trang trống, trang định hướng) thì không đủ để viết mà không bịa. */
export const DOSSIER_MIN_CHARS = 3_000;
/** Số nhân vật (bài liên quan có tên Việt) góp vào truy vấn Wikisource tiếng Việt. */
const VI_PEOPLE_IN_QUERY = 2;

/** Chữ chung đầu tên đề tài — bỏ để còn phần riêng dùng làm từ khoá ("Trận Bạch Đằng" → "Bạch Đằng"). */
const GENERIC_PREFIX = /^(trận|hải chiến|khởi nghĩa|chiến tranh|cuộc vây hãm|cuộc|vụ|(battle|siege|fall|sinking|assassination|invasion|wars?|crossing|conquest)( of)?( the)?)\s+/i;

/** Từ khoá đề tài từ một tiêu đề: bỏ ngoặc và chữ chung; "X's … of the Y" → ["Y", "X"]. */
export function topicKeywords(title: string): string[] {
  const bare = title.replace(/\s*\([^)]*\)/g, "").trim();
  const possessive = bare.match(/^(.+?)'s\s+(.+)$/);
  if (possessive) return [...topicKeywords(possessive[2]), possessive[1].trim()];
  const ofPart = bare.match(/\bof (the )?(.+)$/i);
  const core = (ofPart ? ofPart[2] : bare).replace(GENERIC_PREFIX, "").trim();
  return core ? [core] : [bare];
}

/** Tên có dấu tiếng Việt (bài liên quan là nhân vật/địa danh Việt) — dùng làm từ khoá tìm sử liệu Việt. */
const looksVietnamese = (s: string) => /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/i.test(s);

/** Lớp phụ lỗi bất ngờ → bỏ lớp đó (log), không làm hỏng hồ sơ. */
async function optionalLayer(name: string, load: () => Promise<DossierSource[]>): Promise<DossierSource[]> {
  try {
    return await load();
  } catch (e) {
    console.warn(`⚠ Bỏ lớp ${name}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Gom hồ sơ cho đề tài theo bài Wikipedia tiếng Anh `wikiTitle`. Thứ tự: Wikipedia chính → Wikisource → web → Wikipedia liên quan.
 * Bài chính không tồn tại hoặc hồ sơ quá mỏng → ném lỗi, không viết.
 */
export async function buildDossier(wikiTitle: string, sleep: Sleep = realSleep): Promise<Dossier> {
  const { main, related } = await wikipediaSources(wikiTitle, sleep);
  const viMain = main.find((s) => s.lang === "vi");
  const viPeople = related.map((s) => s.title).filter(looksVietnamese).slice(0, VI_PEOPLE_IN_QUERY);
  const viKeywords = viMain ? [...topicKeywords(viMain.title), ...viPeople] : [];
  const chronicles = viMain
    ? await optionalLayer("Wikisource vi", () => wikisourceSources({ lang: "vi", search: viKeywords.join(" "), keywords: viKeywords }, sleep))
    : [];
  const enKeywords = topicKeywords(wikiTitle);
  const primary = await optionalLayer("Wikisource en", () => wikisourceSources({ lang: "en", search: enKeywords.join(" "), keywords: enKeywords }, sleep));
  const web = await optionalLayer("web", () => webSources(wikiTitle.replace(/\s*\([^)]*\)/g, "")));
  const sources = [...main, ...chronicles, ...primary, ...web, ...related];
  const totalChars = sources.reduce((n, s) => n + s.text.length, 0);
  if (totalChars < DOSSIER_MIN_CHARS)
    throw new Error(`Đề tài "${wikiTitle}" quá ít tư liệu (${totalChars} ký tự) — không viết từ hồ sơ gần như rỗng; đổi đề tài hoặc sửa dòng Wikipedia:.`);
  return { topic: wikiTitle, sources, fetchedAt: new Date().toISOString() };
}

/** Hồ sơ dạng văn bản để đưa vào prompt viết/soát; đầu mục ghi loại nguồn để AI biết thứ bậc tin cậy. */
export function dossierText(d: Dossier): string {
  return d.sources.map((s) => `### ${s.kind ?? "wikipedia"} · ${s.lang} — ${s.title} (${s.url})\n${s.text}`).join("\n\n");
}
