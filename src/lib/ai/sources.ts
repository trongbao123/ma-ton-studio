/**
 * Gom lượt dùng (bảng ai_usage, theo tên model) về các "nguồn" người dùng hiểu: gói Claude, gói ChatGPT,
 * Gemini miễn phí, giọng đọc, ảnh Cloudflare, ảnh DeepInfra… kèm việc nó làm, cách reset và chi phí. Thuần — dùng cả server lẫn client.
 */
export type SourceId = "claude-plan" | "chatgpt-plan" | "chatgpt-image" | "gemini-free" | "voice" | "cloudflare" | "deepinfra" | "claude-api" | "openai-api" | "image-paid" | "zimage";
export type Source = {
  id: SourceId;
  name: string;
  brand: "claude" | "openai" | "gemini" | "cloudflare" | "kaggle" | null;
  /** Việc nguồn này làm trong app. */
  job: string;
  /** Kiểu tính: gói tháng, miễn phí theo ngày, trả theo lượng dùng. */
  billing: "plan" | "free" | "paid";
  reset: string;
  /** Giá ước tính mỗi lượt (USD) — chỉ với nguồn trả theo lượng dùng có giá cố định. */
  unitUsd?: number;
};

export const SOURCES: Source[] = [
  { id: "claude-plan", name: "Claude · gói Pro", brand: "claude", job: "Viết truyện (chính)", billing: "plan", reset: "Theo khung 5 giờ, có giới hạn tuần" },
  { id: "chatgpt-plan", name: "ChatGPT · gói Plus", brand: "openai", job: "Tiêu đề, mô tả, Magic fill", billing: "plan", reset: "Theo khung 5 giờ, có giới hạn tuần" },
  { id: "chatgpt-image", name: "Vẽ ảnh · gói ChatGPT Plus", brand: "openai", job: "Vẽ ảnh cảnh + thumbnail (chính)", billing: "plan", reset: "Theo khung giờ của gói, OpenAI không công bố số lượt" },
  { id: "gemini-free", name: "Gemini API miễn phí", brand: "gemini", job: "Tóm tắt, prompt ảnh, việc bấm từ web", billing: "free", reset: "Mỗi ngày lúc 15:00 (nửa đêm giờ Mỹ)" },
  { id: "voice", name: "Giọng đọc Gemini", brand: "gemini", job: "Đọc chương và Short", billing: "free", reset: "Mỗi ngày lúc 15:00 (nửa đêm giờ Mỹ)" },
  { id: "cloudflare", name: "Cloudflare FLUX", brand: "cloudflare", job: "Đã tắt — ảnh xấu (IMAGE_ALLOW_FLUX=1 để bật)", billing: "free", reset: "Mỗi ngày lúc 7:00" },
  { id: "zimage", name: "Z-Image · GPU Kaggle", brand: "kaggle", job: "Vẽ ảnh phụ — tắt mặc định (ZIMAGE=1 để bật), GPU để dành làm clip", billing: "free", reset: "Dùng chung 30 giờ GPU/tuần với clip động" },
  { id: "deepinfra", name: "DeepInfra FLUX", brand: null, job: "Đã tắt cùng Cloudflare FLUX", billing: "paid", reset: "Trả theo ảnh, không giới hạn", unitUsd: 0.0019 },
  { id: "claude-api", name: "Claude API", brand: "claude", job: "Dự phòng chữ", billing: "paid", reset: "Trả theo lượng dùng" },
  { id: "openai-api", name: "ChatGPT API", brand: "openai", job: "Dự phòng chữ", billing: "paid", reset: "Trả theo lượng dùng" },
  { id: "image-paid", name: "Ảnh trả phí khác", brand: null, job: "Vẽ ảnh (Nano Banana / GPT Image)", billing: "paid", reset: "Trả theo ảnh" },
];

/**
 * Hạn mức free mỗi ngày đã ĐO được (null = nhà cung cấp không công bố / đổi theo tải, chỉ biết khi chạm giới hạn).
 * Gemini chữ: họ flash ~20 lượt/ngày (đo 2026-11-05); giọng đọc: model TTS chính 10 lượt/ngày.
 */
export const DAILY_LIMIT: Partial<Record<SourceId, number>> = { "gemini-free": 20, voice: 10 };

export const sourceOf = (id: SourceId) => SOURCES.find((s) => s.id === id)!;

/** Tên model trong ai_usage → nguồn. Model nội bộ (bắt đầu bằng "_") trả null. */
export function classifyModel(model: string): SourceId | null {
  const m = model.toLowerCase();
  if (m.startsWith("_")) return null;
  const plan = m.endsWith("(gói)");
  if (plan && m.includes("image")) return "chatgpt-image";
  if (plan) return /claude|haiku|sonnet|opus/.test(m) ? "claude-plan" : "chatgpt-plan";
  if (m.startsWith("z-image")) return "zimage";
  if (m.startsWith("@cf/")) return "cloudflare";
  if (m.includes("black-forest-labs/")) return "deepinfra";
  if (/image|nano-banana|imagen/.test(m)) return "image-paid";
  if (m.includes("tts")) return "voice";
  if (/^(gemini|gemma)/.test(m)) return "gemini-free";
  if (m.startsWith("claude")) return "claude-api";
  if (/^(gpt|o\d|chatgpt)/.test(m)) return "openai-api";
  return null;
}

export type UsageRow = { day: string; model: string; calls: number; limited: boolean };
/** `limited`: mọi model của nguồn đều hết lượt (thật sự dừng); `partial`: có model hết lượt nhưng còn model dự phòng chạy. */
export type SourceDay = { calls: number; limited: boolean; partial?: boolean; models: { model: string; calls: number; limited: boolean }[] };

/** Gom các dòng của MỘT ngày theo nguồn. */
export function bySource(rows: UsageRow[]): Partial<Record<SourceId, SourceDay>> {
  const out: Partial<Record<SourceId, SourceDay>> = {};
  for (const r of rows) {
    const id = classifyModel(r.model);
    if (!id) continue;
    const s = (out[id] ??= { calls: 0, limited: false, models: [] });
    s.calls += r.calls;
    s.models.push({ model: r.model, calls: r.calls, limited: r.limited });
  }
  for (const s of Object.values(out)) {
    s!.models.sort((a, b) => b.calls - a.calls);
    s!.limited = s!.models.every((m) => m.limited);
    s!.partial = !s!.limited && s!.models.some((m) => m.limited);
  }
  return out;
}

/** Nửa đêm kế tiếp giờ Los Angeles (Google, YouTube reset quota theo mốc này): tìm giờ UTC trong 26 giờ tới mà ở LA là 00:00. */
export function nextPacificMidnight(now = new Date()): Date | null {
  const la = (d: Date) => d.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit" });
  const start = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
  for (let h = 0; h < 26; h++) {
    const d = new Date(start.getTime() + h * 3_600_000);
    if (la(d) === "00:00" || la(d) === "24:00") return d;
  }
  return null;
}

/** Lần reset kế tiếp (ms) cho nguồn reset theo ngày; null nếu không reset theo giờ cố định. */
export function nextReset(id: SourceId, now = new Date()): Date | null {
  if (id === "cloudflare") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return d;
  }
  if (id === "gemini-free" || id === "voice") return nextPacificMidnight(now);
  return null;
}

/** "còn 3 giờ 20 phút" */
export function untilText(to: Date, now = new Date()) {
  const min = Math.max(0, Math.round((to.getTime() - now.getTime()) / 60_000));
  const h = Math.floor(min / 60);
  return h ? `còn ${h} giờ ${min % 60} phút` : `còn ${min} phút`;
}

/** Đèn trạng thái một nguồn trong ngày. */
export type Lamp = "limited" | "partial" | "active" | "idle" | "off";
export function lampOf(day: SourceDay | undefined, configured: boolean): Lamp {
  if (day?.limited) return "limited";
  if (day?.partial) return "partial";
  if (!configured && !day?.calls) return "off";
  return day?.calls ? "active" : "idle";
}
export const LAMP_TEXT: Record<Lamp, string> = {
  limited: "Chạm giới hạn",
  partial: "Có model hết lượt, đang dùng dự phòng",
  active: "Đang dùng",
  idle: "Chưa dùng hôm nay",
  off: "Chưa kết nối",
};
