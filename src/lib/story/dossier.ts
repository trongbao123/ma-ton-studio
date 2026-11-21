// Hồ sơ tư liệu cho kênh lịch sử: bài Wikipedia tiếng Anh (đề tài ghi trong dàn ý) + bài tiếng Việt qua langlink.
// Kịch bản chỉ được dùng chi tiết trong hồ sơ; lượt soát sự thật đối chiếu với chính hồ sơ này.
import type { Dossier, DossierSource } from "./history-types";

/** Mỗi bài cắt tối đa ngần này ký tự (~12k token) — hai bài vừa một prompt viết. */
export const DOSSIER_MAX_CHARS_PER_SOURCE = 40_000;
/** Dưới ngần này ký tự (trang trống, trang định hướng) thì không đủ để viết mà không bịa. */
export const DOSSIER_MIN_CHARS = 3_000;
/** Wikimedia yêu cầu User-Agent mô tả client — tên chung, không thông tin cá nhân. */
const USER_AGENT = "ma-ton-studio/1.0 (history research bot)";
/**
 * Từ các mục cấp 2 này trở đi là nguồn/liên kết, không phải nội dung. KHÔNG có "Sources": nhiều bài (Thermopylae, Thành Cát Tư Hãn)
 * có mục "Sources" ở ĐẦU bài bàn về sử liệu — cắt ở đó mất gần hết bài.
 */
const TAIL_SECTIONS = ["References", "Tham khảo", "External links", "Liên kết ngoài", "Chú thích", "See also", "Xem thêm", "Notes", "Ghi chú", "Further reading", "Đọc thêm"];

/** Wikimedia trả 429 khi gọi dồn: chờ (theo Retry-After nếu có) rồi thử lại, tối đa ngần này lần. */
const RATE_LIMIT_RETRIES = 4;
const DEFAULT_RETRY_MS = 5_000;
const MS_PER_SECOND = 1000;
const HTTP_TOO_MANY = 429;
/** Chờ giữa các lần thử lại — test truyền bản giả. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

type WikiPage = { title: string; extract?: string; fullurl?: string; missing?: string; invalid?: string; langlinks?: { lang: string; "*": string }[] };

async function fetchWikiPage(lang: "vi" | "en", title: string, sleep: Sleep): Promise<WikiPage> {
  const params = new URLSearchParams({
    action: "query", format: "json", redirects: "1", prop: "extracts|langlinks|info", explaintext: "1", inprop: "url", lllang: "vi", titles: title,
  });
  const url = `https://${lang}.wikipedia.org/w/api.php?${params}`;
  let wikiResponse = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  for (let retry = 0; wikiResponse.status === HTTP_TOO_MANY && retry < RATE_LIMIT_RETRIES; retry++) {
    const waitSeconds = Number(wikiResponse.headers.get("Retry-After"));
    await sleep(waitSeconds > 0 ? waitSeconds * MS_PER_SECOND : DEFAULT_RETRY_MS * (retry + 1));
    wikiResponse = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  }
  if (!wikiResponse.ok) throw new Error(`Wikipedia ${lang} lỗi ${wikiResponse.status} khi lấy "${title}"`);
  const body = (await wikiResponse.json()) as { query?: { pages?: Record<string, WikiPage> } };
  const found = Object.values(body.query?.pages ?? {})[0];
  if (!found) throw new Error(`Wikipedia ${lang} không trả trang cho "${title}"`);
  return found;
}

/** Bỏ phần nguồn/liên kết cuối bài rồi cắt ở ranh giới đoạn gần nhất trước giới hạn. */
function trimArticle(extract: string): string {
  // Chỉ mục cấp 2 ("== X ==" đúng hai dấu bằng) — mục con "=== Notes ===" giữa bài là nội dung.
  const tail = new RegExp(`\\n==[ \\t]*(${TAIL_SECTIONS.join("|")})[ \\t]*==(?!=)`, "i");
  const body = extract.split(tail)[0].trim();
  if (body.length <= DOSSIER_MAX_CHARS_PER_SOURCE) return body;
  const cut = body.lastIndexOf("\n\n", DOSSIER_MAX_CHARS_PER_SOURCE);
  return body.slice(0, cut > 0 ? cut : DOSSIER_MAX_CHARS_PER_SOURCE).trim();
}

const toSource = (lang: "vi" | "en", p: WikiPage): DossierSource => ({ lang, title: p.title, url: p.fullurl ?? "", text: trimArticle(p.extract ?? "") });

/** Gom hồ sơ cho đề tài: bài en (theo redirect) + bài vi nếu có langlink; tiếng Việt đứng trước. */
export async function buildDossier(wikiTitle: string, sleep: Sleep = realSleep): Promise<Dossier> {
  const en = await fetchWikiPage("en", wikiTitle, sleep);
  if (en.missing !== undefined || en.invalid !== undefined)
    throw new Error(`Không tìm thấy bài Wikipedia "${wikiTitle}" — sửa dòng Wikipedia: trong dàn ý đề tài.`);
  const viTitle = en.langlinks?.find((l) => l.lang === "vi")?.["*"];
  const sources = [toSource("en", en)];
  if (viTitle) {
    const viPage = await fetchWikiPage("vi", viTitle, sleep);
    if (viPage.missing === undefined) sources.unshift(toSource("vi", viPage));
  }
  const totalChars = sources.reduce((n, s) => n + s.text.length, 0);
  if (totalChars < DOSSIER_MIN_CHARS)
    throw new Error(`Đề tài "${wikiTitle}" quá ít tư liệu (${totalChars} ký tự) — không viết từ hồ sơ gần như rỗng; đổi đề tài hoặc sửa dòng Wikipedia:.`);
  return { topic: wikiTitle, sources, fetchedAt: new Date().toISOString() };
}

/** Hồ sơ dạng văn bản để đưa vào prompt viết/soát. */
export function dossierText(d: Dossier): string {
  return d.sources.map((s) => `### ${s.lang} — ${s.title} (${s.url})\n${s.text}`).join("\n\n");
}
