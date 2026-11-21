// Lớp sử liệu gốc của hồ sơ: đoạn trích từ Wikisource quanh từ khoá đề tài. Tiếng Việt chỉ nhận các bộ chính sử
// (tìm kiếm Wikisource còn trả tiểu thuyết lịch sử như "Nam cực tinh huy" — không phải sử liệu).
import type { DossierSource } from "./history-types";
import { htmlToText, realSleep, wikiApi, type Sleep } from "./wiki-api";

export const VI_CHRONICLES = [
  "Đại Việt sử ký toàn thư", "Khâm định Việt sử Thông giám cương mục", "Đại Nam thực lục", "Việt sử lược", "An Nam chí lược", "Đại Việt sử lược",
];
export const WIKISOURCE_MAX_PAGES = 3;
export const WIKISOURCE_MAX_CHARS = 6_000;
/** Mỗi phía của từ khoá lấy ngần này ký tự. */
const WINDOW_CHARS = 1_500;
const SEARCH_LIMIT = "10";

/** Các cửa sổ ±1.500 ký tự quanh từ khoá (gộp cửa sổ chồng nhau), cắt `maxChars`; không có từ khoá → "". */
export function excerptAround(text: string, keywords: string[], maxChars: number): string {
  const lower = text.toLowerCase();
  const windows: [number, number][] = [];
  for (const keyword of keywords.map((k) => k.toLowerCase()).filter(Boolean)) {
    for (let at = lower.indexOf(keyword); at >= 0; at = lower.indexOf(keyword, at + keyword.length))
      windows.push([Math.max(0, at - WINDOW_CHARS), Math.min(text.length, at + keyword.length + WINDOW_CHARS)]);
  }
  windows.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged.at(-1);
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([...w]);
  }
  return merged.map(([from, to]) => text.slice(from, to).trim()).join("\n…\n").slice(0, maxChars);
}

const acceptsTitle = (lang: "vi" | "en", title: string) =>
  lang === "vi" ? VI_CHRONICLES.some((c) => title.startsWith(c)) : !title.includes("(disambiguation)");

/** Đoạn sử liệu gốc liên quan đề tài; mọi lỗi → [] (lớp phụ, không làm hỏng hồ sơ). */
export async function wikisourceSources(
  query: { lang: "vi" | "en"; search: string; keywords: string[] },
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
      if (sources.length >= WIKISOURCE_MAX_PAGES) break;
      const parsed = await wikiApi<{ parse?: { text?: string | { "*": string } } }>(host, { action: "parse", page: title, prop: "text" }, sleep);
      const html = typeof parsed.parse?.text === "string" ? parsed.parse.text : (parsed.parse?.text?.["*"] ?? "");
      const text = excerptAround(htmlToText(html), query.keywords, WIKISOURCE_MAX_CHARS);
      if (text) sources.push({ kind: "wikisource", lang: query.lang, title, url: `https://${host}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`, text });
    }
    return sources;
  } catch (e) {
    console.warn(`⚠ Bỏ lớp Wikisource (${query.lang}) "${query.search}":`, e instanceof Error ? e.message : e);
    return [];
  }
}
