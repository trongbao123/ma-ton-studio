import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * vidIQ qua MCP server chính chủ (https://mcp.vidiq.com/mcp), xác thực bằng API key (Account Settings → MCP).
 * Mỗi lượt gọi trừ credit vidIQ (~5 credit). Mọi lỗi chỉ cảnh báo — thiếu vidIQ thì video vẫn ra như thường.
 * Tên tool không được vidIQ công bố cố định nên tìm theo tên lúc chạy.
 */

type Tool = { name: string; description?: string; inputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] } };

let session: Promise<{ client: Client; tools: Tool[] } | null> | null = null;

function connect() {
  session ??= (async () => {
    const key = process.env.VIDIQ_API_KEY;
    if (!key) return null;
    const client = new Client({ name: "ma-ton-studio", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("https://mcp.vidiq.com/mcp"), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }),
    );
    const { tools } = await client.listTools();
    console.log(`  vidIQ: ${tools.length} tool — ${tools.map((t) => t.name).join(", ")}`);
    return { client, tools: tools as Tool[] };
  })().catch((e) => {
    console.warn("⚠ Không nối được vidIQ:", e instanceof Error ? e.message : e);
    return null;
  });
  return session;
}

const pick = (tools: Tool[], test: (name: string) => boolean) => tools.find((t) => test(t.name.toLowerCase()));

/** Điền tham số chính (từ khóa / tiêu đề) vào đúng tên field trong schema của tool. */
function argsFor(tool: Tool, value: string | string[], prefer: string[]) {
  const props = tool.inputSchema?.properties ?? {};
  const names = Object.keys(props);
  const field = prefer.find((p) => names.includes(p)) ?? tool.inputSchema?.required?.find((r) => props[r]?.type === "string" || props[r]?.type === "array") ?? names[0];
  if (!field) return {};
  const isArray = props[field]?.type === "array";
  return { [field]: isArray ? (Array.isArray(value) ? value : [value]) : Array.isArray(value) ? value[0] : value };
}

function textOf(result: unknown) {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .flatMap((c) => (c.type === "text" && c.text ? [c.text] : []))
    .join("\n")
    .trim();
}

/** Từ khóa YouTube liên quan + độ cạnh tranh/lượt tìm, dạng văn bản để đưa vào prompt viết tiêu đề/mô tả/tag. */
export async function keywordResearch(seed: string): Promise<string | null> {
  const s = await connect();
  if (!s) return null;
  const tool = pick(s.tools, (n) => n.includes("keyword") && !n.includes("track")) ?? pick(s.tools, (n) => n.includes("search") && n.includes("trend"));
  if (!tool) {
    console.warn("⚠ vidIQ không có tool nghiên cứu từ khóa.");
    return null;
  }
  try {
    const res = await s.client.callTool({ name: tool.name, arguments: argsFor(tool, seed, ["keyword", "query", "keywords", "topic", "term", "seed"]) });
    if ((res as { isError?: boolean }).isError) throw new Error(textOf(res).slice(0, 200));
    return textOf(res).slice(0, 3500) || null;
  } catch (e) {
    console.warn("⚠ vidIQ nghiên cứu từ khóa lỗi:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Điểm 0–100 cho từng tiêu đề (cùng thứ tự). Tool chấm 1 tiêu đề/lượt thì gọi lần lượt. null nếu không chấm được. */
export async function scoreTitles(titles: string[]): Promise<(number | null)[] | null> {
  const s = await connect();
  if (!s || process.env.VIDIQ_SCORE_TITLES === "0") return null;
  const tool = pick(s.tools, (n) => n.includes("title") && (n.includes("score") || n.includes("rate") || n.includes("grade")));
  if (!tool) return null;
  const score = (text: string) => {
    const m = text.match(/(?:score|điểm)\D{0,12}(\d{1,3}(?:\.\d+)?)/i) ?? text.match(/\b(\d{1,3}(?:\.\d+)?)\s*(?:\/\s*100|%)/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n <= 100 ? n : null;
  };
  const out: (number | null)[] = [];
  for (const t of titles) {
    try {
      const res = await s.client.callTool({ name: tool.name, arguments: argsFor(tool, t, ["title", "titles", "text", "query"]) });
      out.push((res as { isError?: boolean }).isError ? null : score(textOf(res)));
    } catch (e) {
      console.warn("⚠ vidIQ chấm tiêu đề lỗi:", e instanceof Error ? e.message : e);
      out.push(null);
    }
  }
  return out.some((x) => x != null) ? out : null;
}

/** Lấy cặp {tiêu đề, điểm} từ kết quả vidiq_generate_titles (JSON nếu có, không thì đọc từng dòng "Tiêu đề — 87"). */
export function parseScoredTitles(text: string): { title: string; score: number | null }[] {
  const out: { title: string; score: number | null }[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title : typeof o.text === "string" ? o.text : null;
    const raw = o.score ?? o.overallScore ?? o.titleScore;
    if (title) out.push({ title: title.trim(), score: typeof raw === "number" ? raw : Number.isFinite(Number(raw)) ? Number(raw) : null });
    else Object.values(o).forEach(walk);
  };
  try {
    walk(JSON.parse(text));
  } catch {
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(?:\d+[.)]|[-*•])\s*["“]?(.+?)["”]?\s*(?:[—–-]|\(|\|)\s*(?:score|điểm)?\s*:?\s*(\d{1,3})(?:\s*\/\s*100)?\)?\s*$/i);
      if (m) out.push({ title: m[1].replace(/\*\*/g, "").trim(), score: Number(m[2]) });
    }
  }
  return out.filter((x) => x.title.length >= 10 && x.title.length <= 100 && (x.score == null || x.score <= 100));
}

/**
 * vidIQ tự nghĩ tiêu đề kèm điểm (phần "Magic Fill" cho tiêu đề — vidIQ MCP không có Magic Fill mô tả/tag).
 * ~5 credit/lượt. Lỗi / không có tool thì trả [] để pipeline chạy tiếp như thường.
 */
export async function generateTitles(title: string, description: string): Promise<{ title: string; score: number | null }[]> {
  const s = await connect();
  if (!s || process.env.VIDIQ_SCORE_TITLES === "0") return [];
  const tool = pick(s.tools, (n) => n.includes("generate") && n.includes("title"));
  if (!tool) return [];
  try {
    const props = tool.inputSchema?.properties ?? {};
    const args: Record<string, unknown> = { title, description: description.slice(0, 2000) };
    if ("numTitles" in props) args.numTitles = 3;
    if ("language" in props) args.language = "vi";
    if ("regionCode" in props) args.regionCode = "VN";
    const res = await s.client.callTool({ name: tool.name, arguments: args });
    if ((res as { isError?: boolean }).isError) throw new Error(textOf(res).slice(0, 200));
    return parseScoredTitles(textOf(res));
  } catch (e) {
    console.warn("⚠ vidIQ gợi ý tiêu đề lỗi:", e instanceof Error ? e.message : e);
    return [];
  }
}

/** Tên + mô tả các tool vidIQ đang mở (không tốn credit) — để xem có tool kiểu Magic Fill không. */
export async function listVidiqTools() {
  const s = await connect();
  return (s?.tools ?? []).map((t) => ({ name: t.name, description: (t.description ?? "").replace(/\s+/g, " ").slice(0, 200), args: Object.keys(t.inputSchema?.properties ?? {}) }));
}

export async function closeVidiq() {
  const s = await session?.catch(() => null);
  await s?.client.close().catch(() => {});
  session = null;
}
