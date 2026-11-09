/** Định tuyến AI theo việc — thuần, dùng được cả ở server lẫn trang cài đặt. */

export type AiTask = "story" | "summary" | "meta" | "scenes";
export type ProviderId = "anthropic" | "openai" | "gemini";
/** `model` rỗng = model mặc định của nhà cung cấp (Gemini: danh sách dự phòng trong env). */
export type Route = { provider: ProviderId; model: string };
export type Routing = Record<AiTask, Route[]>;

export const TASKS: { id: AiTask; label: string; note: string }[] = [
  { id: "story", label: "Viết truyện", note: "Story bible, dàn ý, viết chương — cần AI viết hay nhất" },
  { id: "summary", label: "Tóm tắt chương", note: "Trí nhớ cho các chương sau" },
  { id: "meta", label: "Tiêu đề / mô tả YouTube", note: "Tiêu đề, mô tả, tag, kịch bản Short, thumbnail" },
  { id: "scenes", label: "Prompt ảnh", note: "Mô tả từng cảnh cho AI vẽ ảnh" },
];

export const PROVIDERS: { id: ProviderId; label: string; env: string; models: string[] }[] = [
  { id: "anthropic", label: "Claude", env: "ANTHROPIC_API_KEY", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"] },
  { id: "openai", label: "ChatGPT", env: "OPENAI_API_KEY", models: ["gpt-5", "gpt-5-mini", "gpt-5-nano"] },
  { id: "gemini", label: "Gemini", env: "GEMINI_API_KEY", models: ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"] },
];

export const DEFAULT_MODEL: Record<ProviderId, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5", gemini: "" };

const ALL: ProviderId[] = ["anthropic", "openai", "gemini"];
const order = (ids: ProviderId[]): Route[] => ids.map((provider) => ({ provider, model: "" }));

/**
 * Mặc định: viết truyện ưu tiên Claude → ChatGPT → Gemini; việc phụ dùng Gemini free trước, hết lượt mới sang AI trả phí.
 * Nhà cung cấp nào chưa có key thì tự bỏ qua lúc chạy.
 */
export function defaultRouting(): Routing {
  return {
    story: order(["anthropic", "openai", "gemini"]),
    summary: order(["gemini", "anthropic", "openai"]),
    meta: order(["gemini", "anthropic", "openai"]),
    scenes: order(["gemini", "anthropic", "openai"]),
  };
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
