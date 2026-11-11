// Hạn mức GPU free của Kaggle (30 giờ/tuần): đọc số thật từ API `GET /api/v1/kernels/quota`, không có thì app tự ước tính từ ai_usage.

const QUOTA_URL = "https://www.kaggle.com/api/v1/kernels/quota";
const WEEK_MS = 7 * 86_400_000;
/** Kaggle làm mới quota GPU vào 00:00 UTC thứ Bảy hằng tuần (đo từ `quotaRefreshTime`). */
const RESET_WEEKDAY_UTC = 6;

export type KaggleQuota = { usedSeconds: number; totalSeconds: number; refreshAt: string; hasEverRun: boolean };

type QuotaResponse = {
  quotaRefreshTime?: string;
  gpuQuota?: { timeUsed?: { seconds?: number | string }; totalTimeAllowed?: { seconds?: number | string }; hasEverRun?: boolean };
};

/** Thân trả về của `/kernels/quota` → số giây GPU đã dùng / được phép; thiếu trường thì null. */
export function parseKaggleQuota(j: QuotaResponse): KaggleQuota | null {
  const gpu = j.gpuQuota;
  const total = Number(gpu?.totalTimeAllowed?.seconds);
  if (!gpu || !Number.isFinite(total) || total <= 0 || !j.quotaRefreshTime) return null;
  return { usedSeconds: Number(gpu.timeUsed?.seconds ?? 0) || 0, totalSeconds: total, refreshAt: j.quotaRefreshTime, hasEverRun: Boolean(gpu.hasEverRun) };
}

/** Lần reset kế tiếp (00:00 UTC thứ Bảy) — dùng khi API không trả. */
export function nextKaggleReset(now = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ahead = (RESET_WEEKDAY_UTC - d.getUTCDay() + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + ahead);
  return d;
}

/** Ngày (yyyy-mm-dd UTC) bắt đầu tuần quota hiện tại, cho `reset` là lần reset kế tiếp. */
export const kaggleWeekStartDay = (reset: Date) => new Date(reset.getTime() - WEEK_MS).toISOString().slice(0, 10);

/** Hạn mức GPU thật từ Kaggle; thiếu token / lỗi mạng thì null (caller ước tính từ ai_usage). */
export async function fetchKaggleGpuQuota(env: NodeJS.ProcessEnv = process.env): Promise<KaggleQuota | null> {
  const token = env.KAGGLE_API_TOKEN?.trim();
  if (!token) return null;
  try {
    const quotaReply = await fetch(QUOTA_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    return quotaReply.ok ? parseKaggleQuota((await quotaReply.json()) as QuotaResponse) : null;
  } catch {
    return null;
  }
}
