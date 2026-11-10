/**
 * Hạn mức thật của gói thuê bao (Claude Pro, ChatGPT Plus qua Codex): phần thuần đọc phản hồi của nhà cung cấp.
 * Lưu/đọc snapshot ở plan-limits-store.ts.
 */
import type { LimitWindow } from "../limits";

export type PlanWindow = { label: string; percent: number; resetsAt: string | null };
export type PlanSnapshot = { windows: PlanWindow[]; plan: string | null; at: string };
export type PlanLimits = { codex?: PlanSnapshot; claude?: PlanSnapshot };

export const PLAN_LIMITS_KEY = "plan_limits";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const numOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clampPercent = (n: number) => Math.min(100, Math.max(0, Math.round(n * 10) / 10));

/** 300 phút → "Khung 5 giờ"; 10080 → "Tuần"; còn lại quy ra giờ / ngày. */
export function windowLabel(minutes: number | null): string {
  if (minutes == null) return "Khung giới hạn";
  if (minutes === 10_080) return "Tuần";
  if (minutes % 1440 === 0) return `${minutes / 1440} ngày`;
  if (minutes % 60 === 0) return `Khung ${minutes / 60} giờ`;
  return `Khung ${minutes} phút`;
}

const isoOfEpoch = (seconds: number) => new Date(seconds * 1000).toISOString();

/**
 * Codex: `rateLimits` của app-server (camelCase: usedPercent, windowDurationMins, resetsAt) hoặc sự kiện
 * token_count trong rollout (snake_case: used_percent, window_minutes, resets_at | resets_in_seconds).
 * Nhận cả object `{ rateLimits: {...} }` bọc ngoài. primary + secondary → tối đa 2 cửa sổ.
 */
export function parseCodexRateLimits(raw: unknown, now = new Date()): { windows: PlanWindow[]; plan: string | null } {
  const root = isObj(raw) && isObj(raw.rateLimits) ? raw.rateLimits : raw;
  if (!isObj(root)) return { windows: [], plan: null };
  const windows: PlanWindow[] = [];
  for (const key of ["primary", "secondary"] as const) {
    const w = root[key];
    if (!isObj(w)) continue;
    const percent = numOf(w.usedPercent) ?? numOf(w.used_percent);
    if (percent == null) continue;
    const minutes = numOf(w.windowDurationMins) ?? numOf(w.window_minutes) ?? numOf(w.windowMinutes);
    const resetAt = numOf(w.resetsAt) ?? numOf(w.resets_at);
    const resetIn = numOf(w.resets_in_seconds) ?? numOf(w.resetsInSeconds);
    const resetsAt = resetAt != null ? isoOfEpoch(resetAt) : resetIn != null ? isoOfEpoch(now.getTime() / 1000 + resetIn) : null;
    windows.push({ label: windowLabel(minutes), percent: clampPercent(percent), resetsAt });
  }
  const plan = typeof root.planType === "string" ? root.planType : typeof root.plan_type === "string" ? root.plan_type : null;
  return { windows, plan };
}

const CLAUDE_WINDOWS = [
  ["five_hour", "Khung 5 giờ"],
  ["seven_day", "Tuần"],
  ["seven_day_opus", "Tuần · Opus"],
  ["seven_day_sonnet", "Tuần · Sonnet"],
] as const;

/** Claude: phản hồi GET /api/oauth/usage — mỗi cửa sổ { utilization (0–100), resets_at (ISO) }; cửa sổ null (gói không có) bị bỏ. */
export function parseClaudeUsage(raw: unknown): PlanWindow[] {
  if (!isObj(raw)) return [];
  const out: PlanWindow[] = [];
  for (const [key, label] of CLAUDE_WINDOWS) {
    const w = raw[key];
    if (!isObj(w)) continue;
    const percent = numOf(w.utilization);
    if (percent == null) continue;
    out.push({ label, percent: clampPercent(percent), resetsAt: typeof w.resets_at === "string" ? w.resets_at : null });
  }
  return out;
}

/** Claude: header `anthropic-ratelimit-unified-{5h,7d}-{utilization (0–1),reset (epoch giây)}` trên mọi phản hồi /v1/messages bằng OAuth. */
export function parseClaudeHeaders(get: (name: string) => string | null): PlanWindow[] {
  const out: PlanWindow[] = [];
  for (const [tag, label] of [["5h", "Khung 5 giờ"], ["7d", "Tuần"]] as const) {
    const util = Number(get(`anthropic-ratelimit-unified-${tag}-utilization`));
    if (get(`anthropic-ratelimit-unified-${tag}-utilization`) == null || !Number.isFinite(util)) continue;
    const reset = Number(get(`anthropic-ratelimit-unified-${tag}-reset`));
    out.push({ label, percent: clampPercent(util * 100), resetsAt: Number.isFinite(reset) && reset > 0 ? isoOfEpoch(reset) : null });
  }
  return out;
}

export const toLimitWindow = (w: PlanWindow): LimitWindow => ({ label: w.label, used: null, total: null, percent: w.percent, unit: "%", resetsAt: w.resetsAt });
