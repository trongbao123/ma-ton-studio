/**
 * Hạn mức thật của từng nguồn AI / dịch vụ — kiểu dữ liệu và phần tính thuần (tỉ lệ, màu, đơn vị YouTube).
 * Phần gọi mạng nằm ở limits-data.ts; hàm ở đây dùng được cả server lẫn client (vd thanh trạng thái).
 */

/** "api" = nhà cung cấp trả số thật; "measured" = số đo được + lượt app tự đếm; "estimate" = tự ước tính; "none" = không công bố. */
export type LimitSource = "api" | "measured" | "estimate" | "none";

export const LIMIT_SOURCE_TEXT: Record<LimitSource, string> = {
  api: "API thật",
  measured: "đo được",
  estimate: "ước tính",
  none: "không công bố",
};

export type LimitWindow = {
  label: string;
  /** Đã dùng / tổng theo `unit`; null khi nhà cung cấp chỉ trả phần trăm. */
  used: number | null;
  total: number | null;
  percent: number | null;
  unit: string;
  /** ISO; null = không biết hoặc không reset theo giờ cố định. */
  resetsAt: string | null;
};

export type LimitBrand = "claude" | "openai" | "gemini" | "cloudflare" | "youtube" | "github" | "vidiq";

export type LimitRow = {
  id: string;
  name: string;
  brand: LimitBrand;
  source: LimitSource;
  windows: LimitWindow[];
  /** Giải thích ngắn: vì sao ước tính / vì sao không đọc được. */
  note: string | null;
  /** Thời điểm số liệu được đo (ISO) khi là bản lưu sẵn. */
  asOf: string | null;
};

export type LimitLevel = "ok" | "warn" | "danger";

/** Từ ngưỡng này trở lên thanh chuyển vàng / đỏ (% đã dùng). */
export const WARN_AT = 60;
export const DANGER_AT = 85;

/** Phần trăm đã dùng, làm tròn, chặn trong 0–100; null khi thiếu số hoặc tổng ≤ 0. */
export function percentUsed(used: number | null, total: number | null): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((used / total) * 100)));
}

export function levelOf(percent: number | null): LimitLevel {
  if (percent == null) return "ok";
  if (percent >= DANGER_AT) return "danger";
  if (percent >= WARN_AT) return "warn";
  return "ok";
}

/** YouTube Data API v3: hạn mức mặc định 10.000 unit/ngày, reset nửa đêm giờ Pacific. */
export const YT_DAILY_UNITS = 10_000;
/** Dòng ai_usage ghi tổng unit YouTube trong ngày (tên bắt đầu "_" nên không lẫn vào các nguồn AI). */
export const YT_USAGE_MODEL = "_yt_units";

/** Chi phí unit mỗi lệnh gọi (bảng quota của YouTube). */
export const YT_COSTS = {
  videoUpload: 1600,
  thumbnailSet: 50,
  videoUpdate: 50,
  playlistItemInsert: 50,
  playlistInsert: 50,
  playlistItemsList: 1,
  videosList: 1,
} as const;
export type YtOp = keyof typeof YT_COSTS;

/** Tổng unit của một tập lệnh gọi, vd { videoUpload: 2, thumbnailSet: 2 } → 3300. */
export function ytUnitsOf(calls: Partial<Record<YtOp, number>>): number {
  return (Object.keys(calls) as YtOp[]).reduce((sum, op) => sum + YT_COSTS[op] * (calls[op] ?? 0), 0);
}

/** Cloudflare Workers AI free: 10.000 neuron/ngày, reset 00:00 UTC. */
export const CF_DAILY_NEURONS = 10_000;
/**
 * Neuron mỗi ảnh FLUX-1-schnell 1024×1024, 4 bước — tính từ bảng giá Cloudflare:
 * (4 tile × $0,000053 + 4 bước × $0,00011) / $0,000011 mỗi neuron ≈ 59,3.
 */
export const CF_NEURONS_PER_IMAGE = 59.3;

export const cfNeuronsOf = (images: number) => Math.round(images * CF_NEURONS_PER_IMAGE);

/** GitHub Actions gói free: 2.000 phút/tháng, reset ngày 1 hằng tháng (UTC). */
export const GH_MONTHLY_MINUTES = 2_000;

/**
 * Hạn mức free/ngày của model Gemini đã ĐO (null = chưa đo được): họ flash ~20 lượt, TTS ~10 lượt.
 * Google không có API đọc quota còn lại nên đây chỉ là mốc để so với số lượt app đếm.
 */
export function geminiDailyLimit(model: string): number | null {
  const m = model.toLowerCase();
  if (m.includes("tts")) return 10;
  if (m.includes("flash")) return 20;
  return null;
}

/** Ngày 1 tháng sau (UTC) — mốc GitHub Actions làm mới phút. */
export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
