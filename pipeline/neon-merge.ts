// Gộp dữ liệu Neon cũ (khoá từ 23/11/2026) vào Supabase đang chạy — KHÔNG xoá, KHÔNG ghi đè dữ liệu mới.
// Phần thuần (lên kế hoạch ánh xạ id) ở đây để test; phần đọc/ghi DB ở pipeline/migrate-neon.ts.
import type { VideoMeta } from "@/db/schema";

/** Chương cũ của bộ được gộp vào bộ đang chạy mang số âm: không đụng số chương mới (unique series+number), vẫn nằm trong danh sách
 *  "truyện đã có" mà prompt dàn ý đọc để tránh trùng đề tài, và đứng trước chương mới khi sắp theo số. */
export const ARCHIVE_NUMBER_OFFSET = -100000;

export type SeriesRow = { id: number; genre: string; channel: string; title: string };
export type ChapterRow = { id: number; seriesId: number; number: number; title: string };

/** Khoá ghép bộ cũ với bộ đang chạy: cùng thể loại + cùng kênh (vd Chuyện đời @ chuyen-doi, Lịch sử @ lich-su). */
const seriesKey = (s: Pick<SeriesRow, "genre" | "channel">) => `${s.genre}@${s.channel}`;
const titleKey = (seriesId: number, title: string) => `${seriesId}|${title.trim().toLowerCase()}`;

/** Bộ cũ → id bộ đang chạy (khi trùng thể loại + kênh) hoặc null (phải thêm mới). */
export function planSeries(old: SeriesRow[], current: SeriesRow[]): Map<number, number | null> {
  const byKey = new Map(current.map((s) => [seriesKey(s), s.id]));
  return new Map(old.map((s) => [s.id, byKey.get(seriesKey(s)) ?? null]));
}

export type ChapterPlan = { kind: "reuse"; targetId: number } | { kind: "insert"; seriesId: number; number: number };

/**
 * Chương cũ: trùng tên với chương đang có trong cùng bộ đích → dùng lại chương đó (video cũ gắn vào); không thì thêm mới.
 * `merged` = bộ đích là bộ đang chạy (gộp) → số âm; bộ thêm mới → giữ số cũ.
 */
export function planChapter(c: ChapterRow, targetSeriesId: number, merged: boolean, currentChapters: ChapterRow[]): ChapterPlan {
  const existing = currentChapters.find((x) => titleKey(x.seriesId, x.title) === titleKey(targetSeriesId, c.title));
  if (existing) return { kind: "reuse", targetId: existing.id };
  return { kind: "insert", seriesId: targetSeriesId, number: merged ? ARCHIVE_NUMBER_OFFSET + c.number : c.number };
}

export type IdMaps = { series: Map<number, number>; chapters: Map<number, number>; videos: Map<number, number> };

/** Đổi các id nằm trong meta video (bản gộp, Short cắt cảnh) sang id mới; id không có trong bản đồ giữ nguyên. */
export function remapVideoMeta(meta: VideoMeta | null, maps: IdMaps): VideoMeta | null {
  if (!meta) return meta;
  const v = (id: number) => maps.videos.get(id) ?? id;
  const next: VideoMeta = { ...meta };
  if (meta.compilation) {
    next.compilation = { ...meta.compilation, seriesId: maps.series.get(meta.compilation.seriesId) ?? meta.compilation.seriesId, videoIds: meta.compilation.videoIds.map(v) };
  }
  if (meta.shortClip) {
    next.shortClip = {
      ...meta.shortClip,
      sourceChapterId: maps.chapters.get(meta.shortClip.sourceChapterId) ?? meta.shortClip.sourceChapterId,
      ...(meta.shortClip.episodeVideoId === undefined ? {} : { episodeVideoId: v(meta.shortClip.episodeVideoId) }),
    };
  }
  return next;
}

const HERO_REF = /^hero_ref_(\d+)$/;
export const PLAYLISTS_KEY = "yt_playlists";

/**
 * Cài đặt cũ → khoá/giá trị sẽ ghi. `hero_ref_<id>` đổi theo id bộ mới; `yt_playlists` ({ [seriesId]: playlistId }) đổi khoá
 * và GỘP với giá trị hiện có (hiện có thắng). Các khoá khác: chỉ thêm khi Supabase chưa có (cài đặt mới luôn thắng).
 */
export function remapSetting(key: string, oldValue: unknown, seriesMap: Map<number, number>, currentSetting: unknown): { key: string; value: unknown; overwrite: boolean } | null {
  const hero = HERO_REF.exec(key);
  if (hero) {
    const id = seriesMap.get(Number(hero[1]));
    return id === undefined ? null : { key: `hero_ref_${id}`, value: oldValue, overwrite: false };
  }
  if (key === PLAYLISTS_KEY && oldValue && typeof oldValue === "object") {
    const remapped = Object.fromEntries(Object.entries(oldValue as Record<string, unknown>).map(([sid, pl]) => [String(seriesMap.get(Number(sid)) ?? sid), pl]));
    const merged = { ...remapped, ...((currentSetting as Record<string, unknown> | null) ?? {}) };
    return { key, value: merged, overwrite: true };
  }
  return { key, value: oldValue, overwrite: false };
}

/** Video cũ còn dở (queued/rendering) không được tự render lại sau khi gộp — bộ đích có thể đang bật autopilot. */
export function importedVideoStatus(status: string): { status: string; error: string | null } {
  if (status === "queued" || status === "rendering") return { status: "failed", error: "Chép từ Neon (dữ liệu cũ) — không tự render; muốn làm tiếp thì bấm render lại." };
  return { status, error: null };
}
