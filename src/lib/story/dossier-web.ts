// Lớp web của hồ sơ: tìm qua Tavily, CHỈ trong danh sách tên miền tin cậy (lượt soát coi hồ sơ là chuẩn — lẫn trang sai thì
// kịch bản sai mà vẫn "đạt"). Không có TAVILY_API_KEY thì bỏ lớp này.
import type { DossierSource } from "./history-types";

export const TRUSTED_DOMAINS = [
  "britannica.com", "worldhistory.org", "history.com", "nationalgeographic.com", "smithsonianmag.com", "livius.org",
  "bbc.co.uk", "bbc.com", "baotanglichsu.vn", "vnexpress.net", "tuoitre.vn", "thanhnien.vn", "nghiencuulichsu.com",
];
/** Báo/trang tiếng Việt không đuôi .vn. */
const VIETNAMESE_DOMAINS = ["nghiencuulichsu.com", "vnexpress.net"];
export const WEB_MAX_PAGES = 5;
export const WEB_MAX_CHARS = 8_000;
/** Trang ngắn hơn ngần này (đoạn trích tìm kiếm, trang lỗi) không đáng đưa vào hồ sơ. */
const WEB_MIN_CHARS = 500;
const TAVILY_RESULTS = 8;

const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** URL thuộc tên miền tin cậy (hoặc tên miền con của nó). */
export function isTrustedUrl(url: string): boolean {
  const host = hostnameOf(url);
  return host !== "" && TRUSTED_DOMAINS.some((d) => onDomain(host, d));
}

type TavilyResult = { title?: string; url: string; content?: string; raw_content?: string | null };

/** Trang web tin cậy về đề tài; không key / lỗi → [] (lớp phụ, không làm hỏng hồ sơ). */
export async function webSources(query: string): Promise<DossierSource[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  try {
    const tavilyResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, search_depth: "advanced", include_domains: TRUSTED_DOMAINS, include_raw_content: true, max_results: TAVILY_RESULTS }),
    });
    if (!tavilyResponse.ok) throw new Error(`Tavily lỗi ${tavilyResponse.status}`);
    const { results = [] } = (await tavilyResponse.json()) as { results?: TavilyResult[] };
    return results
      .filter((r) => isTrustedUrl(r.url))
      .map((r): DossierSource => {
        const host = hostnameOf(r.url);
        const vietnamese = host.endsWith(".vn") || VIETNAMESE_DOMAINS.some((d) => onDomain(host, d));
        return { kind: "web", lang: vietnamese ? "vi" : "en", title: r.title ?? host, url: r.url, text: (r.raw_content || r.content || "").slice(0, WEB_MAX_CHARS).trim() };
      })
      .filter((s) => s.text.length >= WEB_MIN_CHARS)
      .slice(0, WEB_MAX_PAGES);
  } catch (e) {
    console.warn(`⚠ Bỏ lớp web "${query}":`, e instanceof Error ? e.message : e);
    return [];
  }
}
