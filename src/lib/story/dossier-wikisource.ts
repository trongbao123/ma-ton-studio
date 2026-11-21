// Lớp sử liệu gốc của hồ sơ: đoạn trích từ Wikisource quanh từ khoá đề tài. CHỈ nhận các bộ sử / sử gia cổ / bách khoa
// trong danh sách — tìm kiếm Wikisource còn trả tiểu thuyết, kịch, thơ (Nam cực tinh huy, Julius Caesar của Shakespeare,
// War and Peace) mà lượt soát lại coi hồ sơ là chuẩn → lời thoại hư cấu sẽ "đạt".
import type { DossierSource } from "./history-types";
import { htmlToText, realSleep, wikiApi, type Sleep } from "./wiki-api";

export const VI_CHRONICLES = [
  "Đại Việt sử ký toàn thư", "Khâm định Việt sử Thông giám cương mục", "Đại Nam thực lục", "Việt sử lược", "An Nam chí lược", "Đại Việt sử lược",
];
/** Sử gia cổ (bản dịch) và bách khoa cũ — mặc định từ chối mọi trang ngoài danh sách. */
export const EN_PRIMARY_WORKS = [
  "The History of Herodotus", "The Histories of Herodotus", "History of the Peloponnesian War", "The History of the Peloponnesian War",
  "Plutarch's Lives", "Lives (Dryden translation)", "The Parallel Lives", "The History of Rome (Livy)", "The History of Rome",
  "Ab Urbe Condita", "The Anabasis of Alexander", "Commentaries on the Gallic War", "The Gallic Wars", "The Lives of the Twelve Caesars",
  "Lives of the Twelve Caesars", "The Annals (Tacitus)", "The Histories (Polybius)", "The Histories of Polybius", "Roman History (Cassius Dio)",
  "1911 Encyclopædia Britannica", "Dictionary of Greek and Roman Biography and Mythology", "Dictionary of Greek and Roman Geography",
];
export const WIKISOURCE_MAX_PAGES = 3;
export const WIKISOURCE_MAX_CHARS = 6_000;
/** Mỗi phía của từ khoá lấy ngần này ký tự. */
const WINDOW_CHARS = 1_500;
const SEARCH_LIMIT = "10";

/** `topic`: từ khoá của chính đề tài (phần tử đầu là cụm đầy đủ); `extra`: tên người/địa danh từ bài liên quan. */
export type TopicTerms = { topic: string[]; extra: string[] };

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Khớp theo ranh giới chữ (Unicode): "Qin" không khớp "Qing", "Hastings" khớp "Hastings" chứ không phải chữ dài hơn. */
const termPattern = (term: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term)}(?![\\p{L}\\p{N}])`, "giu");

/** Cửa sổ được nhận khi có cụm đầy đủ của đề tài, hoặc có ít nhất một từ đề tài VÀ ≥ 2 từ khoá khác nhau. */
function windowIsOnTopic(windowText: string, terms: TopicTerms): boolean {
  const has = (t: string) => termPattern(t).test(windowText);
  if (terms.topic[0] && has(terms.topic[0])) return true;
  const topicHits = terms.topic.filter(has);
  if (!topicHits.length) return false;
  const distinct = new Set([...topicHits, ...terms.extra.filter(has)].map((t) => t.toLowerCase()));
  return distinct.size >= 2;
}

/** Các cửa sổ ±1.500 ký tự quanh từ đề tài, chỉ giữ cửa sổ đúng đề tài (xem windowIsOnTopic), gộp chồng nhau, cắt `maxChars`. */
export function excerptAround(text: string, terms: TopicTerms, maxChars: number): string {
  const windows: [number, number][] = [];
  for (const term of terms.topic.filter(Boolean)) {
    for (const match of text.matchAll(termPattern(term))) {
      const at = match.index ?? 0;
      windows.push([Math.max(0, at - WINDOW_CHARS), Math.min(text.length, at + term.length + WINDOW_CHARS)]);
    }
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged.at(-1);
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged
    .map(([from, to]) => text.slice(from, to).trim())
    .filter((w) => windowIsOnTopic(w, terms))
    .join("\n…\n")
    .slice(0, maxChars);
}

const acceptsTitle = (lang: "vi" | "en", title: string) =>
  (lang === "vi" ? VI_CHRONICLES : EN_PRIMARY_WORKS).some((work) => title.startsWith(work));

/** Đoạn sử liệu gốc liên quan đề tài (tối đa `maxPages` trang); mọi lỗi → [] (lớp phụ, không làm hỏng hồ sơ). */
export async function wikisourceSources(
  query: { lang: "vi" | "en"; search: string; terms: TopicTerms; maxPages: number },
  sleep: Sleep = realSleep,
): Promise<DossierSource[]> {
  const host = `${query.lang}.wikisource.org`;
  try {
    const found = await wikiApi<{ query?: { search?: { title: string }[] } }>(
      host,
      { action: "query", list: "search", srsearch: query.search, srnamespace: "0", srlimit: SEARCH_LIMIT },
      sleep,
    );
    const titles = (found.query?.search ?? []).map((r) => r.title).filter((t) => acceptsTitle(query.lang, t));
    const sources: DossierSource[] = [];
    for (const title of titles) {
      if (sources.length >= query.maxPages) break;
      const parsed = await wikiApi<{ parse?: { text?: string | { "*": string } } }>(
        host,
        { action: "parse", page: title, prop: "text", disableeditsection: "1" },
        sleep,
      );
      const html = typeof parsed.parse?.text === "string" ? parsed.parse.text : (parsed.parse?.text?.["*"] ?? "");
      const text = excerptAround(htmlToText(html), query.terms, WIKISOURCE_MAX_CHARS);
      if (text) sources.push({ kind: "wikisource", lang: query.lang, title, url: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, text });
    }
    return sources;
  } catch (e) {
    console.warn(`⚠ Bỏ lớp Wikisource (${query.lang}) "${query.search}":`, e instanceof Error ? e.message : e);
    return [];
  }
}
