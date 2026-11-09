/** Định tuyến AI theo việc — thuần, dùng được cả ở server lẫn trang cài đặt. */

export type AiTask = "story" | "summary" | "meta" | "scenes";
/** API (trả theo lượng dùng) và CLI đăng nhập bằng gói Pro/Plus (không tốn credit API, chỉ chạy trên GitHub Actions). */
export type ProviderId = "anthropic" | "openai" | "gemini" | "claude-cli" | "codex-cli" | "gemini-cli";
/** `model` rỗng = model mặc định của nhà cung cấp (Gemini: danh sách dự phòng trong env; CLI: model mặc định của gói). */
export type Route = { provider: ProviderId; model: string };
export type Routing = Record<AiTask, Route[]>;

export const TASKS: { id: AiTask; label: string; note: string }[] = [
  { id: "story", label: "Viết truyện", note: "Story bible, dàn ý, viết chương — văn hay nhất: Claude" },
  { id: "summary", label: "Tóm tắt chương", note: "Việc nhẹ — Gemini API free cho đỡ lượt của Claude/ChatGPT" },
  { id: "meta", label: "Tiêu đề / mô tả YouTube", note: "Ngắn nhưng quyết định lượt bấm — ChatGPT / Claude" },
  { id: "scenes", label: "Prompt ảnh", note: "Prompt tiếng Anh nhiều cảnh — Gemini API free" },
];

export type ProviderInfo = { id: ProviderId; label: string; env: string; models: string[]; brand: "claude" | "openai" | "gemini"; cli?: string; note?: string };

export const PROVIDERS: ProviderInfo[] = [
  { id: "claude-cli", label: "Claude (gói Pro)", env: "CLAUDE_CODE_OAUTH_TOKEN", models: ["haiku", "sonnet", "opus"], brand: "claude", cli: "claude" },
  { id: "codex-cli", label: "ChatGPT (gói Plus)", env: "CODEX_AUTH_JSON", models: ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"], brand: "openai", cli: "codex" },
  {
    id: "gemini-cli",
    label: "Gemini (gói Google)",
    env: "GEMINI_OAUTH_CREDS",
    models: [],
    brand: "gemini",
    cli: "gemini",
    note: "Google đã ngừng cho tài khoản cá nhân dùng Gemini CLI (chỉ còn qua Antigravity) — Gemini chạy bằng Gemini API free.",
  },
  { id: "anthropic", label: "Claude API", env: "ANTHROPIC_API_KEY", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"], brand: "claude" },
  { id: "openai", label: "ChatGPT API", env: "OPENAI_API_KEY", models: ["gpt-5", "gpt-5-mini", "gpt-5-nano"], brand: "openai" },
  { id: "gemini", label: "Gemini API", env: "GEMINI_API_KEY", models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"], brand: "gemini" },
];

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "gpt-5",
  gemini: "",
  "claude-cli": "",
  "codex-cli": "",
  "gemini-cli": "",
};

export const isCli = (p: ProviderId) => Boolean(PROVIDERS.find((x) => x.id === p)?.cli);

const ALL = PROVIDERS.map((p) => p.id);
const r = (provider: ProviderId, model = ""): Route => ({ provider, model });

/**
 * Mặc định: gói Pro/Plus (CLI, không tốn credit) đứng trước, chia việc cho đỡ hết lượt một gói —
 * truyện cho Claude, tiêu đề/mô tả cho ChatGPT, việc nhẹ (tóm tắt, prompt ảnh) cho Gemini API free.
 * Gemini CLI không nằm trong mặc định: Google đã ngừng cho tài khoản cá nhân dùng (IneligibleTierError UNSUPPORTED_CLIENT).
 * Gemini API để trống model = tự chọn theo hạng việc (quality / cheap). AI chưa có key / không chạy được ở nơi này thì tự bỏ qua.
 */
/** Model rẻ nhất của từng gói — mặc định dùng cho mọi việc để đỡ hết lượt gói (người dùng chọn). */
export const PLAN_MODEL = { claude: "haiku", codex: "gpt-6-luna" } as const;

export function defaultRouting(): Routing {
  const claude = r("claude-cli", PLAN_MODEL.claude);
  const codex = r("codex-cli", PLAN_MODEL.codex);
  return {
    story: [claude, codex, r("anthropic", "claude-opus-5-5"), r("openai", "gpt-5"), r("gemini")],
    meta: [codex, claude, r("anthropic", "claude-sonnet-5-5"), r("openai", "gpt-5"), r("gemini")],
    summary: [r("gemini"), codex, claude, r("openai", "gpt-5-nano"), r("anthropic", "claude-haiku-5-5")],
    scenes: [r("gemini"), codex, claude, r("openai", "gpt-5-mini"), r("anthropic", "claude-haiku-5-5")],
  };
}

/** Đưa một AI lên đầu chuỗi của một việc (đổi nhanh trên màn flow); bỏ bản trùng, giữ các AI còn lại làm dự phòng. */
export function promote(routing: Routing, task: AiTask, route: Route): Routing {
  const same = (x: Route) => x.provider === route.provider && x.model === route.model;
  return { ...routing, [task]: [route, ...routing[task].filter((x) => !same(x))].slice(0, MAX_ROUTES) };
}

const MAX_ROUTES = 8;

/** Lọc cấu hình đã lưu: bỏ dòng sai, việc nào trống thì về mặc định. */
export function normalizeRouting(raw: unknown): Routing {
  const def = defaultRouting();
  const src = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    TASKS.map(({ id }) => {
      const list = Array.isArray(src[id]) ? (src[id] as unknown[]) : [];
      const routes = list.flatMap((r) => {
        const x = r as Partial<Route>;
        return x && ALL.includes(x.provider as ProviderId)
          ? [{ provider: x.provider as ProviderId, model: typeof x.model === "string" ? x.model.trim().slice(0, 80) : "" }]
          : [];
      });
      return [id, routes.length ? routes.slice(0, MAX_ROUTES) : def[id]];
    }),
  ) as Routing;
}

export const ROUTING_KEY = "ai_routing";

// ── Vẽ ảnh

export type ImageProviderId = "cloudflare" | "gemini" | "openai";
export type ImageRoute = { provider: ImageProviderId; model: string };

export const IMAGE_PROVIDERS: { id: ImageProviderId; label: string; env: string; models: string[]; note: string }[] = [
  { id: "cloudflare", label: "Cloudflare FLUX", env: "CLOUDFLARE_API_TOKEN", models: ["@cf/black-forest-labs/flux-1-schnell"], note: "free ~1 video/ngày" },
  { id: "gemini", label: "Gemini (Nano Banana)", env: "GEMINI_API_KEY", models: ["gemini-nano-banana-2.1", "gemini-3.1-flash-lite-image", "gemini-3-pro-image"], note: "trả phí theo ảnh" },
  { id: "openai", label: "ChatGPT (GPT Image)", env: "OPENAI_API_KEY", models: ["gpt-image-2"], note: "trả phí theo ảnh" },
];

export const DEFAULT_IMAGE_MODEL: Record<ImageProviderId, string> = {
  cloudflare: "@cf/black-forest-labs/flux-1-schnell",
  gemini: "gemini-nano-banana-2.1",
  openai: "gpt-image-2",
};

/** Mặc định chỉ Cloudflare free (hết quota thì video chờ hôm sau) — AI vẽ trả phí do người dùng tự thêm. */
export function defaultImageRouting(): ImageRoute[] {
  return [{ provider: "cloudflare", model: "" }];
}

export function normalizeImageRouting(raw: unknown): ImageRoute[] {
  const ids = IMAGE_PROVIDERS.map((p) => p.id);
  const list = Array.isArray(raw) ? raw : [];
  const routes = list.flatMap((r) => {
    const x = r as Partial<ImageRoute>;
    return x && ids.includes(x.provider as ImageProviderId)
      ? [{ provider: x.provider as ImageProviderId, model: typeof x.model === "string" ? x.model.trim().slice(0, 80) : "" }]
      : [];
  });
  return routes.length ? routes.slice(0, 6) : defaultImageRouting();
}

export const IMAGE_ROUTING_KEY = "image_routing";
