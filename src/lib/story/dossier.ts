// Hồ sơ tư liệu cho kênh lịch sử — điều phối 3 lớp nguồn: Wikipedia (chính + liên quan), sử liệu gốc Wikisource,
// web tin cậy (Tavily). Kịch bản chỉ được dùng chi tiết trong hồ sơ; lượt soát sự thật đối chiếu với chính hồ sơ này.
import { isBroadTitle, MAIN_MAX_CHARS, wikipediaSources } from "./dossier-wikipedia";
import { WIKISOURCE_MAX_PAGES, wikisourceSources } from "./dossier-wikisource";
import { webSources } from "./dossier-web";
import type { Dossier, DossierSource } from "./history-types";
import { realSleep, type Sleep } from "./wiki-api";

/** Trần ký tự mỗi bài Wikipedia chính (giữ tên cũ cho nơi đang dùng). */
export const DOSSIER_MAX_CHARS_PER_SOURCE = MAIN_MAX_CHARS;
/** Dưới ngần này ký tự (trang trống, trang định hướng) thì không đủ để viết mà không bịa. */
export const DOSSIER_MIN_CHARS = 3_000;
/** Số nhân vật (bài liên quan có tên Việt) góp vào truy vấn Wikisource tiếng Việt. */
const VI_PEOPLE_IN_QUERY = 2;

/** Chữ chung đầu tên đề tài — bỏ để còn phần riêng ("Trận Bạch Đằng" → "Bạch Đằng"). */
const GENERIC_PREFIX = /^(trận|hải chiến|khởi nghĩa|chiến tranh|cuộc vây hãm|cuộc|vụ|(battle|siege|fall|sinking|assassination|invasion|wars?|crossing|conquest)( of)?( the)?)\s+/i;
/** Từ khoá ngắn hơn ngần này ("Qin") khớp nhầm quá nhiều. */
const MIN_TERM_CHARS = 4;
const usableTerm = (t: string) => t.length >= MIN_TERM_CHARS && !isBroadTitle(t);
/** Phần riêng của tên: sau "of (the)" nếu có, bỏ chữ chung đầu. */
const coreOf = (name: string) => {
  const ofPart = name.match(/\bof (the )?(.+)$/i);
  return (ofPart ? ofPart[2] : name).replace(GENERIC_PREFIX, "").trim();
};

/**
 * Từ khoá đề tài: [cụm đầy đủ (bỏ ngoặc), phần riêng, chủ sở hữu "X's", năm trong ngoặc]. Phần riêng/chủ sở hữu quá ngắn hoặc là
 * trang rộng (Russia, China…) bị bỏ — giữ cụm đầy đủ để "Battle of Hastings" không khớp Warren Hastings.
 */
export function topicTerms(title: string): string[] {
  const bare = title.replace(/\s*\([^)]*\)/g, "").trim();
  const year = title.match(/\((\d{3,4})( BC)?\)/)?.[1];
  const possessive = bare.match(/^(.+?)'s\s+(.+)$/);
  const core = coreOf(possessive ? possessive[2] : bare);
  const terms = [bare];
  if (core && core !== bare && usableTerm(core)) terms.push(core);
  if (possessive && usableTerm(possessive[1].trim())) terms.push(possessive[1].trim());
  if (year) terms.push(year);
  return terms;
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

/** Đoạn chính sử Việt: tìm theo phần riêng tên trận + tên nhân vật Việt; đoạn phải đúng đề tài (xem excerptAround). */
function viChronicles(viTitle: string, viPeople: string[], sleep: Sleep): Promise<DossierSource[]> {
  const topic = topicTerms(viTitle);
  const search = [topic[1] ?? topic[0], ...viPeople].join(" ");
  return wikisourceSources({ lang: "vi", search, terms: { topic, extra: viPeople }, maxPages: WIKISOURCE_MAX_PAGES }, sleep);
}

/**
 * Gom hồ sơ cho đề tài theo bài Wikipedia tiếng Anh `wikiTitle`. Thứ tự: Wikipedia chính → Wikisource → web → Wikipedia liên quan.
 * Bài chính không tồn tại hoặc hồ sơ quá mỏng → ném lỗi, không viết.
 */
export async function buildDossier(wikiTitle: string, sleep: Sleep = realSleep): Promise<Dossier> {
  const { main, related } = await wikipediaSources(wikiTitle, sleep);
  const viMain = main.find((s) => s.lang === "vi");
  const viPeople = related.map((s) => s.title).filter(looksVietnamese).slice(0, VI_PEOPLE_IN_QUERY);
  // Sử Việt trước; sử gia cổ / bách khoa tiếng Anh lấy phần còn lại — tổng Wikisource tối đa WIKISOURCE_MAX_PAGES trang.
  const chronicles = viMain ? await optionalLayer("Wikisource vi", () => viChronicles(viMain.title, viPeople, sleep)) : [];
  const enRoom = WIKISOURCE_MAX_PAGES - chronicles.length;
  const enTerms = topicTerms(wikiTitle);
  const primary = enRoom > 0
    ? await optionalLayer("Wikisource en", () => wikisourceSources({ lang: "en", search: enTerms[1] ?? enTerms[0], terms: { topic: enTerms, extra: [] }, maxPages: enRoom }, sleep))
    : [];
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
