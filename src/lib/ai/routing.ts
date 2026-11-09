/** Định tuyến AI theo việc — thuần, dùng được cả ở server lẫn trang cài đặt. */

export type AiTask = "story" | "summary" | "meta" | "scenes";
export type ProviderId = "anthropic" | "openai" | "gemini";
/** `model` rỗng = model mặc định của nhà cung cấp (Gemini: danh sách dự phòng trong env). */
export type Route = { provider: ProviderId; model: string };
export type Routing = Record<AiTask, Route[]>;

export const TASKS: { id: AiTask; label: string; note: string }[] = [
  { id: "story", label: "Viết truyện", note: "Story bible, dàn ý, viết chương — văn hay nhất: Claude Opus" },
  { id: "summary", label: "Tóm tắt chương", note: "Việc nhẹ — model rẻ nhất (Gemini lite) cho đỡ token" },
  { id: "meta", label: "Tiêu đề / mô tả YouTube", note: "Ngắn nhưng quyết định lượt bấm — Claude Sonnet / GPT-5" },
  { id: "scenes", label: "Prompt ảnh", note: "Prompt tiếng Anh nhiều cảnh — model nhanh, rẻ" },
];

export const PROVIDERS: { id: ProviderId; label: string; env: string; models: string[] }[] = [
  { id: "anthropic", label: "Claude", env: "ANTHROPIC_API_KEY", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] },
  { id: "openai", label: "ChatGPT", env: "OPENAI_API_KEY", models: ["gpt-5", "gpt-5-mini", "gpt-5-nano"] },
  { id: "gemini", label: "Gemini", env: "GEMINI_API_KEY", models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"] },
];

export const DEFAULT_MODEL: Record<ProviderId, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5", gemini: "" };

const ALL: ProviderId[] = ["anthropic", "openai", "gemini"];
const r = (provider: ProviderId, model = ""): Route => ({ provider, model });

/**
 * Mặc định chia việc theo thế mạnh và giá: AI viết hay nhất cho truyện, model tầm trung cho tiêu đề/mô tả,
 * model rẻ cho tóm tắt và prompt ảnh. Gemini để trống model = tự chọn theo hạng việc (quality / cheap) trong danh sách dự phòng.
 * Nhà cung cấp nào chưa có key thì tự bỏ qua lúc chạy.
 */
export function defaultRouting(): Routing {
  return {
    story: [r("anthropic", "claude-opus-5-5"), r("openai", "gpt-5"), r("gemini")],
    meta: [r("anthropic", "claude-sonnet-5-5"), r("openai", "gpt-5"), r("gemini")],
    summary: [r("gemini"), r("openai", "gpt-5-nano"), r("anthropic", "claude-haiku-5-5")],
    scenes: [r("gemini"), r("openai", "gpt-5-mini"), r("anthropic", "claude-haiku-5-5")],
  };
}

/** Đưa một AI lên đầu chuỗi của một việc (đổi nhanh trên màn flow); bỏ bản trùng, giữ các AI còn lại làm dự phòng. */
export function promote(routing: Routing, task: AiTask, route: Route): Routing {
  const same = (x: Route) => x.provider === route.provider && x.model === route.model;
  return { ...routing, [task]: [route, ...routing[task].filter((x) => !same(x))].slice(0, 6) };
}

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
      return [id, routes.length ? routes.slice(0, 6) : def[id]];
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
