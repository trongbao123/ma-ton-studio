// Gọi MediaWiki Action API (Wikipedia, Wikisource) cho hồ sơ tư liệu: User-Agent theo yêu cầu Wikimedia, thử lại khi bị 429.

/** Wikimedia yêu cầu User-Agent mô tả client — tên chung, không thông tin cá nhân. */
export const WIKI_USER_AGENT = "ma-ton-studio/1.0 (history research bot)";
/** Wikimedia trả 429 khi gọi dồn: chờ (theo Retry-After nếu có) rồi thử lại, tối đa ngần này lần. */
const RATE_LIMIT_RETRIES = 4;
const DEFAULT_RETRY_MS = 5_000;
const MS_PER_SECOND = 1000;
const HTTP_TOO_MANY = 429;

/** Chờ giữa các lần thử lại — test truyền bản giả. */
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET https://<host>/w/api.php?format=json&<params>; 429 → chờ rồi thử lại; lỗi HTTP khác → ném có tên host. */
export async function wikiApi<T>(host: string, params: Record<string, string>, sleep: Sleep = realSleep): Promise<T> {
  const url = `https://${host}/w/api.php?${new URLSearchParams({ format: "json", ...params })}`;
  const request = () => fetch(url, { headers: { "User-Agent": WIKI_USER_AGENT } });
  let wikiResponse = await request();
  for (let retry = 0; wikiResponse.status === HTTP_TOO_MANY && retry < RATE_LIMIT_RETRIES; retry++) {
    const waitSeconds = Number(wikiResponse.headers.get("Retry-After"));
    await sleep(waitSeconds > 0 ? waitSeconds * MS_PER_SECOND : DEFAULT_RETRY_MS * (retry + 1));
    wikiResponse = await request();
  }
  if (!wikiResponse.ok) throw new Error(`${host} lỗi ${wikiResponse.status}`);
  return (await wikiResponse.json()) as T;
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** HTML trang (Wikisource) → chữ thuần: bỏ script/style và thẻ, giữ xuống dòng theo khối, giải mã entity. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&(#39|[a-z]+);/gi, (entity, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
