import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { AnthropicProvider } from "./anthropic";
import { GeminiProvider, QuotaExhaustedError } from "./gemini";
import { OpenAIProvider } from "./openai";
import { DEFAULT_MODEL, normalizeRouting, PROVIDERS, ROUTING_KEY, type ProviderId, type Route, type Routing } from "./routing";
import type { JsonRequest, TextProvider, TextRequest } from "./types";

export type { TextProvider } from "./types";
export { QuotaExhaustedError } from "./gemini";

const list = (v: string | undefined, d: string) => (v ?? d).split(",").map((m) => m.trim()).filter(Boolean);
const GEMINI_QUALITY = list(process.env.GEMINI_MODELS, "gemini-3.8-flash,gemini-3.6-flash,gemini-3-flash-preview,gemini-3.5-flash-lite,gemma-4-31b-it");
const GEMINI_CHEAP = list(process.env.GEMINI_CHEAP_MODELS, "gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemma-4-31b-it,gemini-3-flash-preview");

const keyOf = (p: ProviderId) => process.env[PROVIDERS.find((x) => x.id === p)!.env];

/** Nhà cung cấp nào đang có API key trong môi trường chạy hiện tại (Vercel hoặc GitHub Actions). */
export function availableProviders(): ProviderId[] {
  return PROVIDERS.filter((p) => keyOf(p.id)).map((p) => p.id);
}

// Giữ instance theo (provider, model) để nhớ model Gemini nào đã hết quota trong suốt tiến trình.
const cache = new Map<string, TextProvider>();

export function providerFor(route: Route): TextProvider {
  const model = route.model || DEFAULT_MODEL[route.provider];
  const id = `${route.provider}:${model}`;
  let p = cache.get(id);
  if (!p) {
    const key = keyOf(route.provider)!;
    if (route.provider === "anthropic") p = new AnthropicProvider(key, model);
    else if (route.provider === "openai") p = new OpenAIProvider(key, model);
    else p = new GeminiProvider(key, model ? { quality: [model], cheap: [model] } : { quality: GEMINI_QUALITY, cheap: GEMINI_CHEAP });
    cache.set(id, p);
  }
  return p;
}

let routingCache: { at: number; value: Routing } | null = null;

/** Cài đặt định tuyến (lưu trong DB), nhớ 60 giây để không truy vấn mỗi lần gọi AI. */
export async function loadRouting(fresh = false): Promise<Routing> {
  if (!fresh && routingCache && Date.now() - routingCache.at < 60_000) return routingCache.value;
  let raw: unknown = null;
  if (process.env.DATABASE_URL) {
    const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, ROUTING_KEY)).catch(() => []);
    raw = row?.value ?? null;
  }
  routingCache = { at: Date.now(), value: normalizeRouting(raw) };
  return routingCache.value;
}

/**
 * Gộp nhiều AI theo việc: thử lần lượt theo thứ tự trong cài đặt (bỏ qua AI chưa có key).
 * AI nào lỗi / hết quota / từ chối thì sang AI kế tiếp; tất cả đều hết quota mới báo QuotaExhaustedError để job chờ lượt sau.
 */
class RouterProvider implements TextProvider {
  readonly name = "router";
  lastModel?: string;

  private async run<T>(req: TextRequest, call: (p: TextProvider) => Promise<T>): Promise<T> {
    const task = req.task ?? (req.tier === "cheap" ? "summary" : "story");
    const have = availableProviders();
    const chain = (await loadRouting())[task].filter((r) => have.includes(r.provider));
    if (!chain.length) throw new Error("Chưa có AI nào dùng được — thêm ít nhất một API key (Gemini, Claude hoặc ChatGPT).");
    let quota = 0;
    let last: unknown;
    for (const route of chain) {
      const p = providerFor(route);
      try {
        const out = await call(p);
        this.lastModel = p.lastModel;
        return out;
      } catch (e) {
        last = e;
        if (e instanceof QuotaExhaustedError) quota++;
        console.warn(`⚠ ${route.provider}${route.model ? ` (${route.model})` : ""} lỗi, thử AI kế tiếp:`, e instanceof Error ? e.message.slice(0, 200) : e);
      }
    }
    const detail = last instanceof Error ? last.message : String(last);
    if (quota === chain.length) throw new QuotaExhaustedError(`Hết lượt mọi AI cho việc này — chờ lượt sau. (${detail})`);
    throw last instanceof Error ? last : new Error(detail);
  }

  generateText(req: TextRequest) {
    return this.run(req, (p) => p.generateText(req));
  }

  generateJson<T>(req: JsonRequest<T>) {
    return this.run(req, (p) => p.generateJson(req));
  }
}

let router: RouterProvider | undefined;

export function textProvider(): TextProvider {
  router ??= new RouterProvider();
  return router;
}
