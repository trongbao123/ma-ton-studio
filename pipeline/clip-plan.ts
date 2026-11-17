// Phần thuần của "Short cắt cảnh" (3 Short/ngày: 1 Short của tập + tối đa 2 Short cắt từ chương) — không đụng DB/ffmpeg, dễ test.
import { YT_COSTS, YT_DAILY_UNITS } from "@/lib/limits";
import { composeDescription, hashtagOf } from "./description";
import { chooseTitle, type ScoredTitle } from "./vidiq";

/** Mỗi lượt daily làm tối đa ngần này Short cắt cảnh. */
export const CLIPS_PER_RUN = 2;
/** Mỗi ngày (giờ VN) tạo tối đa ngần này Short cắt cảnh; cộng Short của tập = 3 Short/ngày. */
export const CLIPS_PER_DAY = 2;
/** Điểm vidIQ mục tiêu của tiêu đề Short và số vòng xin vidIQ gợi ý thêm. */
export const CLIP_TITLE_TARGET = 85;
export const CLIP_TITLE_ROUNDS = 2;
/** Giờ đăng (UTC) theo thứ tự ưu tiên: 12h và 21h VN trước, 18h VN chỉ khi hai khung kia không dùng được. Không đụng 15h (08 UTC) của tập. */
export const CLIP_SLOT_HOURS_UTC = [5, 14, 11] as const;
/** Khung giờ phải còn cách hiện tại ít nhất ngần này để YouTube không đăng ngay. */
const SLOT_MIN_LEAD_MS = 30 * 60_000;
const SLOT_SEARCH_DAYS = 60;
/** Unit YouTube cho 1 Short cắt cảnh: upload + thêm vào playlist + dư (tạo playlist lần đầu). */
export const CLIP_UNITS = YT_COSTS.videoUpload + YT_COSTS.playlistItemInsert + YT_COSTS.playlistInsert;
/** Chừa lại cho phần còn lại của ngày (tập, thumbnail, bù Short) — Short cắt cảnh không được ăn hết hạn mức. */
export const CLIP_UNITS_RESERVE = 1800;
export const SHORTS_TAG = "#shorts";
const TITLE_MAX = 100;

const hourKey = (d: Date) => d.toISOString().slice(0, 13);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Khung giờ đăng kế tiếp cho Short cắt cảnh: mỗi khung (ngày + giờ) tối đa 1 Short, mỗi ngày tối đa `perDay` Short.
 * Duyệt từng ngày theo thứ tự CLIP_SLOT_HOURS_UTC nên 18h chỉ được chọn khi 12h/21h của ngày đó đã qua hoặc đã có người giữ.
 */
export function pickClipSlot(taken: Date[], now: Date, perDay = CLIPS_PER_DAY): Date {
  const hours = new Set(taken.map(hourKey));
  const perDayCount = new Map<string, number>();
  for (const t of taken) perDayCount.set(dayKey(t), (perDayCount.get(dayKey(t)) ?? 0) + 1);
  const earliest = now.getTime() + SLOT_MIN_LEAD_MS;
  for (let i = 0; i < SLOT_SEARCH_DAYS; i++) {
    for (const h of CLIP_SLOT_HOURS_UTC) {
      const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i, h));
      if (at.getTime() >= earliest && !hours.has(hourKey(at)) && (perDayCount.get(dayKey(at)) ?? 0) < perDay) return at;
    }
  }
  throw new Error("Không còn khung giờ trống cho Short trong 60 ngày tới");
}

/** Số Short cắt cảnh nên làm lượt này: theo trần lượt, trần ngày và unit YouTube còn lại (đã trừ phần chừa). */
export function clipsToMake(o: { createdToday: number; usedUnits: number; perRun?: number; perDay?: number }): number {
  const room = Math.floor((YT_DAILY_UNITS - CLIP_UNITS_RESERVE - o.usedUnits) / CLIP_UNITS);
  return Math.max(0, Math.min(o.perRun ?? CLIPS_PER_RUN, (o.perDay ?? CLIPS_PER_DAY) - o.createdToday, room));
}

/** Còn đủ unit để upload thêm 1 Short cắt cảnh không (kiểm lại ngay trước khi upload). */
export const canUploadClip = (usedUnits: number) => clipsToMake({ createdToday: 0, usedUnits, perRun: 1, perDay: 1 }) >= 1;

export type ClipSource = {
  chapterId: number;
  number: number;
  /** Tập chứa chương này (đã đăng hoặc sắp đăng). */
  episodeVideoId: number;
  episodeYoutubeId: string | null;
  episodePublishAt: Date | null;
};

/** Chương nguồn: chưa từng cắt Short, chương mới nhất trước, tối đa `limit`. Mỗi chương chỉ cắt một lần (đánh dấu theo chương). */
export function pickClipSources(candidates: ClipSource[], usedChapterIds: Iterable<number>, limit: number): ClipSource[] {
  const used = new Set(usedChapterIds);
  const seen = new Set<number>();
  return candidates
    .filter((c) => !used.has(c.chapterId) && !seen.has(c.chapterId) && seen.add(c.chapterId))
    .sort((a, b) => b.number - a.number)
    .slice(0, limit);
}

/** Tiêu đề luôn có #shorts, tổng ≤ 100 ký tự (cắt phần chữ, giữ nguyên thẻ). */
export function ensureShortsTag(title: string, max = TITLE_MAX): string {
  const clean = title.replace(/#shorts/gi, "").replace(/\s+/g, " ").trim();
  const room = max - SHORTS_TAG.length - 1;
  const body = clean.length > room ? `${clean.slice(0, room - 1).trimEnd()}…` : clean;
  return `${body} ${SHORTS_TAG}`;
}

/** Chọn tiêu đề Short: điểm vidIQ cao nhất (luật của chooseTitle), rồi gắn #shorts. */
export function pickClipTitle(all: ScoredTitle[]): ScoredTitle {
  const best = chooseTitle(all);
  return { title: ensureShortsTag(best.title), score: best.score };
}

/** Link "nghe full": tập đã công khai khi Short lên sóng thì link tập, không thì link danh sách phát. */
export function fullEpisodeUrl(o: { episodeYoutubeId: string | null; episodePublishAt: Date | null; clipPublishAt: Date; playlistUrl: string }): string {
  const live = o.episodeYoutubeId && (!o.episodePublishAt || o.episodePublishAt.getTime() <= o.clipPublishAt.getTime());
  return live ? `https://youtu.be/${o.episodeYoutubeId}` : o.playlistUrl;
}

/** 5 hashtag: 4 cố định của kênh + tên bộ truyện. */
export function clipHashtags(seriesTitle: string): string[] {
  return [SHORTS_TAG, "#truyentutien", "#truyenaudio", "#tienhiep", hashtagOf(seriesTitle).toLowerCase()].filter((h, i, a) => h.length > 3 && a.indexOf(h) === i);
}

/** Mô tả Short: 2–3 câu từ khóa + dòng "Nghe FULL tập" + link danh sách phát + hashtag + ghi công nhạc. */
export function buildClipDescription(o: { body: string; fullUrl: string; playlistUrl: string; seriesTitle: string; tail?: string; channelUrl?: string }): string {
  return composeDescription(o.body, [], [`▶ Nghe FULL tập: ${o.fullUrl}`, `📚 Danh sách phát trọn bộ: ${o.playlistUrl}`], clipHashtags(o.seriesTitle), o.tail ?? "", o.channelUrl);
}

/** Tag Short: top từ khóa tìm thật (VN) trước, rồi tag cố định; bỏ trùng, không phân biệt hoa thường. */
export function clipTags(keywords: string[], seriesTitle: string): string[] {
  const base = ["truyện tu tiên", "truyện audio", "truyện tiên hiệp", "shorts", seriesTitle];
  return [...keywords.slice(0, 10), ...base].filter((t, i, a) => t.trim() && a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i);
}
