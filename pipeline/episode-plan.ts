// Phần thuần của chế độ "tập dài mỗi ngày" (không đụng DB/ffmpeg) — dễ test.
// Mỗi ngày đăng 1 tập ghép từ `episodeChapters` chương; video chương chỉ render nội bộ.
import type { VideoMeta } from "@/db/schema";
import { formatTimestamp } from "./compile-plan";

/** Số tập tối đa chờ đăng — đủ kho thì thôi viết, không đốt quota AI và phút Actions. */
export const EPISODE_BUFFER = 2;
/** Ảnh tối đa mỗi video chương: 3 chương/ngày × 30 ≈ 90 ảnh, vừa quota ảnh free. */
export const EPISODE_MAX_IMAGES = 30;
/** Video chương nội bộ: 1 ảnh ~60 giây. */
const EPISODE_IMAGE_SECONDS = 60;
/** Video chương thường: 1 ảnh ~25 giây, tối đa 30. */
const DEFAULT_IMAGE_SECONDS = 25;
const MIN_IMAGES = 6;
const VN_OFFSET_MS = 7 * 3600_000;

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) — marker "đã viết hôm nay" reset lúc 0h VN. */
export function vnDay(at = new Date()) {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tên dòng ai_usage đếm số chương đã viết trong ngày VN của một bộ truyện. */
export const writtenMarker = (seriesId: number) => `_written_${seriesId}`;

/**
 * Số chương cần viết thêm lượt này: còn chỉ tiêu ngày VÀ kho chưa vượt `maxEpisodes` tập
 * (kho tính theo chương: tập chờ đăng × chương/tập + chương lẻ chưa vào tập).
 */
export function chaptersToWrite(o: { chaptersPerDay: number; writtenToday: number; stockChapters: number; episodeChapters: number; maxEpisodes?: number }) {
  const room = (o.maxEpisodes ?? EPISODE_BUFFER) * o.episodeChapters - o.stockChapters;
  return Math.max(0, Math.min(o.chaptersPerDay - o.writtenToday, room));
}

/** Số ảnh cho video chương: nội bộ (tập) 1 ảnh/60 giây, tối đa 30; thường 1 ảnh/25 giây, tối đa 30. Luôn ≥ 6. */
export function imageCount(seconds: number, episode: boolean) {
  const per = episode ? EPISODE_IMAGE_SECONDS : DEFAULT_IMAGE_SECONDS;
  return Math.min(EPISODE_MAX_IMAGES, Math.max(MIN_IMAGES, Math.round(seconds / per)));
}

/**
 * Khung giờ đăng kế tiếp (`hourUtc` mỗi ngày, 1 video/ngày): hôm nay nếu còn ≥ 2 giờ, không thì mai;
 * bỏ qua ngày (UTC) đã có người giữ trong `taken`. Dựng tập trễ → khung tự lùi sang ngày sau.
 */
export function pickPublishSlot(taken: Date[], hourUtc: number, now = new Date()) {
  const days = new Set(taken.map((t) => t.toISOString().slice(0, 10)));
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  if (slot.getTime() - now.getTime() < 2 * 3600_000) slot.setUTCDate(slot.getUTCDate() + 1);
  while (days.has(slot.toISOString().slice(0, 10))) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}

/** Video có tính vào lịch ngày không: video chương thường và tập có; bản gộp 5 chương cũ có khung riêng nên không. */
export const occupiesDailySlot = (meta: VideoMeta | null) => !meta?.compilation || Boolean(meta.compilation.episode);

type BacklogRow = {
  id: number;
  status: "queued" | "rendering" | "ready" | "failed" | "published";
  number: number;
  youtubeVideoId: string | null;
  publishAt: Date | null;
  hasLong: boolean;
  meta: VideoMeta | null;
};

/**
 * Hàng tồn của chế độ tập: `upcoming` = tập chưa lên sóng (đang dựng / chờ đăng, không tính tập lỗi);
 * `loose` = video chương chưa thuộc tập nào, chưa đăng lẻ, và số chương lớn hơn mọi chương đã đăng lẻ
 * (chương cũ đã đăng lẻ giữ nguyên, tập đầu bắt đầu sau chúng). `ready` = loose đã render xong, sẵn ghép.
 */
export function episodeBacklog<T extends BacklogRow>(rows: T[], now = new Date()) {
  const episodes = rows.filter((r) => r.meta?.compilation?.episode);
  const upcoming = episodes.filter((r) => r.status !== "failed" && (!r.publishAt || r.publishAt > now));
  const used = new Set(episodes.filter((r) => r.status !== "failed").flatMap((r) => r.meta!.compilation!.videoIds));
  const publishedMax = Math.max(0, ...rows.filter((r) => !r.meta?.compilation && r.youtubeVideoId).map((r) => r.number));
  const loose = rows.filter((r) => !r.meta?.compilation && !r.youtubeVideoId && r.status !== "failed" && r.status !== "published" && r.number > publishedMax && !used.has(r.id));
  const ready = loose.filter((r) => r.status === "ready" && r.hasLong);
  return { upcoming, loose, ready };
}

export type TocItem = { number: number; title: string; seconds: number; sub: { start: number; title: string }[] };

/**
 * Mục lục YouTube cho tập: mỗi chương một mốc "Chương N: …" rồi các mục con "· tên đoạn" (cộng dồn thời lượng các chương trước).
 * Mục con đầu (00:00 của chương) bỏ vì trùng mốc chương.
 */
export function buildEpisodeToc(items: TocItem[]) {
  const toc: { start: number; title: string }[] = [];
  let offset = 0;
  for (const it of items) {
    toc.push({ start: offset, title: `Chương ${it.number}: ${it.title}` });
    for (const s of it.sub.slice(1)) toc.push({ start: offset + s.start, title: `· ${s.title}` });
    offset += it.seconds;
  }
  return toc;
}

/** Dạng text của mục lục (để test/hiển thị). */
export const tocText = (toc: { start: number; title: string }[]) => toc.map((t) => `${formatTimestamp(t.start)} ${t.title}`).join("\n");

/** Nhãn thời lượng cho tiêu đề: "FULL 2H" (làm tròn giờ, tối thiểu 1H). */
export const fullLabel = (seconds: number) => `FULL ${Math.max(1, Math.round(seconds / 3600))}H`;

/** Tiêu đề luôn có nhãn tập (AI/vidIQ có thể bỏ): thiếu "Tập N" / "FULL" thì nối "| Tập N (Chương X–Y)"; cắt ≤ 100 ký tự. */
export function ensureEpisodeLabel(title: string, o: { episodeNo: number; from: number; to: number }) {
  const t = title.trim();
  if (/tập\s*\d+|full/i.test(t)) return t.length > 100 ? `${t.slice(0, 99)}…` : t;
  const tag = ` | Tập ${o.episodeNo} (Chương ${o.from}–${o.to})`;
  return `${t.slice(0, 100 - tag.length).trimEnd()}${tag}`;
}
