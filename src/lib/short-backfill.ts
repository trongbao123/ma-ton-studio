// Phần thuần của việc bù Short cho tập đã lên YouTube mà thiếu Short (pipeline và màn flow cùng dùng).
import type { VideoMeta } from "@/db/schema";

/** Chỉ bù cho tập tạo trong ngần này ngày. */
export const BACKFILL_WINDOW_DAYS = 10;
/** Lỗi khác hết quota quá ngần này lần thì bỏ cuộc. */
export const BACKFILL_MAX_ATTEMPTS = 3;
/** Mỗi lượt daily bù tối đa ngần này Short. */
export const BACKFILL_PER_RUN = 2;
/** Short công khai sau lịch tập ngần này giờ. */
export const SHORT_DELAY_HOURS = 2;

export type ShortBackfill = NonNullable<VideoMeta["shortBackfill"]>;
export type BackfillOutcome = { kind: "ok" } | { kind: "quota" } | { kind: "error"; message: string };

export type BackfillCandidate = {
  id: number;
  createdAt: Date;
  youtubeVideoId: string | null;
  youtubeShortId: string | null;
  meta: VideoMeta | null;
};

const DAY_MS = 24 * 3600_000;

/** Tập đã lên YouTube mà chưa có Short (chưa xét cửa sổ ngày / bỏ cuộc). */
export function missingEpisodeShort(v: Pick<BackfillCandidate, "youtubeVideoId" | "youtubeShortId" | "meta">): boolean {
  return Boolean(v.meta?.compilation?.episode && v.youtubeVideoId && !v.youtubeShortId);
}

export function gaveUp(meta: VideoMeta | null): boolean {
  return Boolean(meta?.shortBackfill?.gaveUp);
}

/** Tập cần bù Short: trong cửa sổ ngày, chưa bỏ cuộc; cũ nhất trước, tối đa `limit`. */
export function pickShortBackfill(rows: BackfillCandidate[], now: Date, limit = BACKFILL_PER_RUN): BackfillCandidate[] {
  const since = now.getTime() - BACKFILL_WINDOW_DAYS * DAY_MS;
  return rows
    .filter((v) => missingEpisodeShort(v) && !gaveUp(v.meta) && v.createdAt.getTime() >= since)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, limit);
}

/** Cập nhật marker sau một lần thử: hết quota không tính lần; lỗi khác +1, đủ MAX thì bỏ cuộc. */
export function nextBackfillState(prev: ShortBackfill | undefined, outcome: BackfillOutcome): ShortBackfill {
  const attempts = prev?.attempts ?? 0;
  if (outcome.kind === "ok") return { attempts, done: true };
  if (outcome.kind === "quota") return { attempts, lastReason: "quota" };
  const next = attempts + 1;
  return { attempts: next, lastReason: "error", lastError: outcome.message.slice(0, 300), ...(next >= BACKFILL_MAX_ATTEMPTS ? { gaveUp: true } : {}) };
}

/** Giờ công khai của Short: sau lịch tập 2 giờ; tập đã công khai (hoặc sắp tới giờ đó) thì null = đăng công khai ngay. */
export function shortPublishAt(episodePublishAt: Date | null, now: Date): Date | null {
  if (!episodePublishAt) return null;
  const at = new Date(episodePublishAt.getTime() + SHORT_DELAY_HOURS * 3600_000);
  return at.getTime() > now.getTime() + 15 * 60_000 ? at : null;
}

/** Lỗi YouTube do hết hạn mức (units/ngày hoặc số lần upload) — thử lại lượt sau, không tính lần. */
export function isYoutubeQuotaMessage(msg: string): boolean {
  return /quotaExceeded|uploadLimitExceeded|rateLimitExceeded|dailyLimitExceeded/i.test(msg);
}

/** Mô tả trạng thái chờ bù Short cho màn flow; null = không thuộc diện bù. */
export function backfillStatusText(v: Pick<BackfillCandidate, "youtubeVideoId" | "youtubeShortId" | "meta">): { text: string; final: boolean } | null {
  if (!missingEpisodeShort(v)) return null;
  const b = v.meta?.shortBackfill;
  if (b?.gaveUp) return { text: `bỏ cuộc sau ${b.attempts} lần lỗi${b.lastError ? `: ${b.lastError}` : ""}`, final: true };
  if (b?.lastReason === "quota") return { text: "chờ làm Short (hết quota)", final: false };
  if (b?.lastReason === "error") return { text: `chờ làm Short (lỗi lần ${b.attempts}/${BACKFILL_MAX_ATTEMPTS})`, final: false };
  return { text: "chờ làm Short", final: false };
}
