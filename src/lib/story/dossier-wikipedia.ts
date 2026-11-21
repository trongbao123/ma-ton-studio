// Lớp Wikipedia của hồ sơ tư liệu: bài chính (en theo redirect + vi qua langlink) và tối đa 5 bài liên quan
// lấy từ liên kết trong phần mở đầu bài tiếng Anh (nhân vật, đối thủ, địa danh, sự kiện trước/sau).
import type { DossierSource } from "./history-types";
import { realSleep, wikiApi, type Sleep } from "./wiki-api";

/** Mỗi bài chính cắt tối đa ngần này ký tự (~12k token). */
export const MAIN_MAX_CHARS = 40_000;
export const RELATED_MAX = 5;
export const RELATED_MAX_CHARS = 8_000;
/**
 * Từ các mục cấp 2 này trở đi là nguồn/liên kết, không phải nội dung. KHÔNG có "Sources": nhiều bài (Thermopylae, Thành Cát Tư Hãn)
 * có mục "Sources" ở ĐẦU bài bàn về sử liệu — cắt ở đó mất gần hết bài.
 */
const TAIL_SECTIONS = ["References", "Tham khảo", "External links", "Liên kết ngoài", "Chú thích", "See also", "Xem thêm", "Notes", "Ghi chú", "Further reading", "Đọc thêm"];
/** Liên kết trỏ tới trang quá rộng — thêm vào hồ sơ chỉ là nhiễu. */
const BROAD_TITLES = new Set(
  ["Vietnam", "China", "France", "Japan", "Russia", "England", "United Kingdom", "Greece", "Italy", "Spain", "Germany", "Mongolia",
   "Korea", "India", "Persia", "Europe", "Asia", "Roman Empire", "Byzantine Empire", "Ottoman Empire"].map((t) => t.toLowerCase()),
);
const JUNK_TITLE = /\((identifier|disambiguation)\)|coordinate|killed in action|^year \d+|^\d+( (bc|ad|bce|ce))?$/i;

type WikiPage = { title: string; extract?: string; fullurl?: string; missing?: string; invalid?: string; langlinks?: { lang: string; "*": string }[] };

async function fetchWikiPage(lang: "vi" | "en", title: string, sleep: Sleep): Promise<WikiPage> {
  const body = await wikiApi<{ query?: { pages?: Record<string, WikiPage> } }>(
    `${lang}.wikipedia.org`,
    { action: "query", redirects: "1", prop: "extracts|langlinks|info", explaintext: "1", inprop: "url", lllang: "vi", titles: title },
    sleep,
  );
  const found = Object.values(body.query?.pages ?? {})[0];
  if (!found) throw new Error(`Wikipedia ${lang} không trả trang cho "${title}"`);
  return found;
}

/** Bỏ phần nguồn/liên kết cuối bài rồi cắt ở ranh giới đoạn gần nhất trước giới hạn. */
export function trimArticle(extract: string, maxChars: number): string {
  // Chỉ mục cấp 2 ("== X ==" đúng hai dấu bằng) — mục con "=== Notes ===" giữa bài là nội dung.
  const tail = new RegExp(`\\n==[ \\t]*(${TAIL_SECTIONS.join("|")})[ \\t]*==(?!=)`, "i");
  const body = extract.split(tail)[0].trim();
  if (body.length <= maxChars) return body;
  const cut = body.lastIndexOf("\n\n", maxChars);
  return body.slice(0, cut > 0 ? cut : maxChars).trim();
}

const toSource = (lang: "vi" | "en", p: WikiPage, maxChars: number): DossierSource => ({
  kind: "wikipedia", lang, title: p.title, url: p.fullurl ?? "", text: trimArticle(p.extract ?? "", maxChars),
});

const timesMentioned = (title: string, text: string) => text.toLowerCase().split(title.toLowerCase()).length - 1;

/** Bài liên quan đáng lấy: bỏ rác/trang rộng/trùng bài chính, xếp theo số lần được nhắc trong bài chính. */
export function pickRelatedTitles(leadLinks: string[], articleText: string, mainTitle: string): string[] {
  const unique = [...new Set(leadLinks)].filter(
    (t) => t !== mainTitle && !JUNK_TITLE.test(t) && !BROAD_TITLES.has(t.toLowerCase()),
  );
  return unique
    .map((title) => ({ title, mentions: timesMentioned(title, articleText) }))
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, RELATED_MAX)
    .map((x) => x.title);
}

async function relatedSources(main: WikiPage, sleep: Sleep): Promise<DossierSource[]> {
  const parsed = await wikiApi<{ parse?: { links?: { ns: number; "*": string }[] } }>(
    "en.wikipedia.org",
    { action: "parse", page: main.title, section: "0", prop: "links" },
    sleep,
  );
  const leadLinks = (parsed.parse?.links ?? []).filter((l) => l.ns === 0).map((l) => l["*"]);
  const related: DossierSource[] = [];
  for (const title of pickRelatedTitles(leadLinks, main.extract ?? "", main.title)) {
    const page = await fetchWikiPage("en", title, sleep);
    if (page.missing === undefined && page.extract) related.push(toSource("en", page, RELATED_MAX_CHARS));
  }
  return related;
}

/** Bài chính (vi trước, en sau) + bài liên quan. Bài en không tồn tại → ném; lớp liên quan lỗi → bỏ qua (log). */
export async function wikipediaSources(wikiTitle: string, sleep: Sleep = realSleep): Promise<{ main: DossierSource[]; related: DossierSource[] }> {
  const en = await fetchWikiPage("en", wikiTitle, sleep);
  if (en.missing !== undefined || en.invalid !== undefined)
    throw new Error(`Không tìm thấy bài Wikipedia "${wikiTitle}" — sửa dòng Wikipedia: trong dàn ý đề tài.`);
  const main = [toSource("en", en, MAIN_MAX_CHARS)];
  const viTitle = en.langlinks?.find((l) => l.lang === "vi")?.["*"];
  if (viTitle) {
    const viPage = await fetchWikiPage("vi", viTitle, sleep);
    if (viPage.missing === undefined) main.unshift(toSource("vi", viPage, MAIN_MAX_CHARS));
  }
  const related = await relatedSources(en, sleep).catch((e: unknown) => {
    console.warn(`⚠ Bỏ bài Wikipedia liên quan của "${wikiTitle}":`, e instanceof Error ? e.message : e);
    return [];
  });
  return { main, related };
}
