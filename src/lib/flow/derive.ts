import type { BrandId } from "@/components/brand-icons";
import { DEFAULT_IMAGE_MODEL, PROVIDERS, type ImageRoute, type ProviderId, type Route } from "@/lib/ai/routing";
import { classifyModel, type UsageRow } from "@/lib/ai/sources";
import type { VideoProgress } from "./progress";

/** Các hàm thuần suy dữ liệu hiển thị cho màn flow — tách riêng để test, không đụng DB. */

export type ImagePick = { model: string; source: "tracked" | "usage" | "configured" };

const IMAGE_SOURCES = new Set(["chatgpt-image", "cloudflare", "deepinfra", "image-paid"]);

/** Bỏ tiền tố nhà cung cấp cho gọn: "@cf/black-forest-labs/flux-1-schnell" → "flux-1-schnell". */
export function shortImageModel(model: string) {
  return model.replace(/^@cf\/[^/]+\/|^black-forest-labs\//, "");
}

/**
 * Model vẽ ảnh THẬT của video. Ưu tiên tên pipeline ghi lúc vẽ (progress.steps.images.model),
 * không có thì suy từ lượt dùng AI vẽ nhiều nhất trong ngày render (ai_usage), cuối cùng mới là model cấu hình (dự kiến).
 */
export function pickImageModel(input: { tracked?: string | null; usage: Pick<UsageRow, "model" | "calls">[]; configured: string }): ImagePick {
  const tracked = input.tracked?.trim();
  if (tracked) return { model: tracked, source: "tracked" };
  const used = input.usage
    .filter((r) => r.calls > 0 && IMAGE_SOURCES.has(classifyModel(r.model) ?? ""))
    .sort((a, b) => b.calls - a.calls)[0];
  if (used) return { model: shortImageModel(used.model), source: "usage" };
  return { model: shortImageModel(input.configured), source: "configured" };
}

/**
 * Model vẽ đầu danh sách theo đúng cách pipeline/images.ts xếp: có CODEX_AUTH_JSON mà chưa xếp Codex
 * thì Codex (gói ChatGPT Plus) được đưa lên đầu.
 */
export function configuredImageModel(routes: ImageRoute[], hasCodexAuth: boolean) {
  const first: ImageRoute = hasCodexAuth && !routes.some((r) => r.provider === "codex") ? { provider: "codex", model: "" } : routes[0];
  return first.model || DEFAULT_IMAGE_MODEL[first.provider];
}

/** Tên bài nhạc nền từ dòng ghi công `Nhạc nền: "<title>" – Kevin MacLeod…` trong mô tả; không có → null. */
export function musicTitle(description: string | null | undefined) {
  const m = description?.match(/Nhạc nền:\s*["“]([^"”\n]+)["”]/);
  return m ? m[1].trim() : null;
}

/** Video bản gộp chứa một video chương — đủ thông tin để hiện thẻ YouTube. */
export type CompilationRef = {
  id: number;
  from: number;
  to: number;
  videoIds: number[];
  youtubeVideoId: string | null;
  status: string;
};

/** Bản gộp (mới nhất) có chứa video này; bỏ qua chính nó. */
export function containingCompilation(videoId: number, candidates: CompilationRef[]): CompilationRef | null {
  return (
    candidates
      .filter((c) => c.id !== videoId && c.videoIds.includes(videoId))
      .sort((a, b) => b.id - a.id)[0] ?? null
  );
}

export type AiTag = { label: string; brand: BrandId | null; note?: string };

/** AI đầu chuỗi mà đã có key (hoặc đầu chuỗi nếu chưa AI nào chạy được) — AI sẽ được gọi trước. */
export function firstUsableRoute(chain: Route[], available: ProviderId[]): Route | null {
  return chain.find((r) => available.includes(r.provider)) ?? chain[0] ?? null;
}

/** Route → nhãn + logo hãng: {claude-cli, haiku} → "haiku" + Claude. */
export function describeRoute(route: Route): AiTag {
  const p = PROVIDERS.find((x) => x.id === route.provider);
  return { label: route.model || p?.label || route.provider, brand: p?.brand ?? null };
}

/** Logo cho tên model vẽ ảnh đã bỏ tiền tố: gpt-image → OpenAI, flux-1-schnell (Cloudflare) → Cloudflare. */
export function imageBrand(model: string): BrandId | null {
  if (/^gpt/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "gemini";
  // Cloudflare ghi chữ thường "flux-1-schnell"; DeepInfra là "FLUX-1-…" (không có logo riêng).
  if (/^flux-1-/.test(model)) return "cloudflare";
  if (/^z-image/i.test(model)) return "kaggle";
  return null;
}

/** Số ảnh cảnh đã vẽ / tổng: ưu tiên bộ đếm của bước Ảnh cảnh, không có thì đếm file cảnh. */
export function imageCounts(p: VideoProgress | null | undefined): { done: number; total: number } | null {
  const s = p?.steps.images;
  const parts = [s?.long, s?.short].filter((x): x is { done: number; total: number } => Boolean(x && x.total > 0));
  if (parts.length) return { done: parts.reduce((a, x) => a + x.done, 0), total: parts.reduce((a, x) => a + x.total, 0) };
  const scenes = [...(p?.scenes?.long ?? []), ...(p?.scenes?.short ?? [])];
  return scenes.length ? { done: scenes.filter((x) => x.file).length, total: scenes.length } : null;
}

/** 1234567 → "1.234.567" — tự định dạng vì toLocaleString của Node và trình duyệt khác nhau → lỗi hydration. */
export function thousands(n: number) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
