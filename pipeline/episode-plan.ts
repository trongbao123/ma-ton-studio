// Phần thuần của chế độ "tập dài mỗi ngày" (không đụng DB/ffmpeg) — dễ test.
// Mỗi ngày đăng 1 tập ghép từ `episodeChapters` chương; video chương chỉ render nội bộ.
import type { VideoMeta } from "@/db/schema";
import { formatTimestamp } from "./compile-plan";

/**
 * Kho tập chờ đăng (đã dựng + hẹn giờ sẵn trên YouTube): 4 tập = 4 ngày dự phòng — GitHub bỏ lượt cron,
 * hết quota AI/ảnh một ngày thì lịch đăng vẫn đều. Đủ kho thì thôi viết, không đốt quota AI và phút Actions.
 */
export const EPISODE_BUFFER = 4;
/** Kho chưa đủ thì được viết tới gấp mấy lần chỉ tiêu ngày để bù (6 chương/ngày ≈ 136 ảnh, vừa quota ảnh free). */
export const CATCH_UP_FACTOR = 2;
/** Ảnh tối đa mỗi video chương: 3 chương/ngày × 30 ≈ 90 ảnh, vừa quota ảnh free. */
export const EPISODE_MAX_IMAGES = 80;
/** Chương thường (đăng lẻ) giữ trần cũ. */
const DEFAULT_MAX_IMAGES = 30;
/** Video chương nội bộ: 1 ảnh ~30 giây (ảnh đổi theo diễn biến truyện). */
const EPISODE_IMAGE_SECONDS = 30;
/** Video chương thường: 1 ảnh ~25 giây, tối đa 30. */
const DEFAULT_IMAGE_SECONDS = 25;
const MIN_IMAGES = 6;
const SHORT_IMAGE_SECONDS = 3.5;
const VN_OFFSET_MS = 7 * 3600_000;

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) — marker "đã viết hôm nay" reset lúc 0h VN. */
export function vnDay(at = new Date()) {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Tên dòng ai_usage đếm số chương đã viết trong ngày VN của một bộ truyện. */
export const writtenMarker = (seriesId: number) => `_written_${seriesId}`;

/**
 * Số chương cần viết thêm lượt này: viết trước liên tục tới khi kho đủ `maxEpisodes` tập, đến ngày thì đăng
 * (kho tính theo chương: tập chờ đăng × chương/tập + chương lẻ chưa vào tập).
 * Mỗi ngày tối đa CATCH_UP_FACTOR × chỉ tiêu: viết đúng chỉ tiêu thì kho không bao giờ dày lên (đăng 1 tập = viết 1 tập),
 * lỡ 1 lượt là hụt. Kho đầy thì chỉ viết bù đúng phần đã đăng.
 */
export function chaptersToWrite(o: { chaptersPerDay: number; writtenToday: number; stockChapters: number; episodeChapters: number; maxEpisodes?: number }) {
  const room = (o.maxEpisodes ?? EPISODE_BUFFER) * o.episodeChapters - o.stockChapters;
  return Math.max(0, Math.min(o.chaptersPerDay * CATCH_UP_FACTOR - o.writtenToday, room));
}

/** Đoạn mở đầu cao trào: ~6 giây đổi 1 ảnh, 4–8 ảnh. */
export function coldOpenSceneCount(seconds: number) {
  return Math.min(8, Math.max(4, Math.round(seconds / 6)));
}

/** Short: ~3,5 giây đổi 1 ảnh (người lướt Shorts bỏ đi nếu hình đứng yên), 5–30 ảnh. */
export function shortSceneCount(seconds: number) {
  return Math.min(30, Math.max(5, Math.round(seconds / SHORT_IMAGE_SECONDS)));
}

/** Hai phút đầu của chương nội bộ đổi ảnh nhanh (~6 giây/ảnh) — phút đầu quyết định người xem từ đề xuất ở lại hay thoát. */
export const FAST_OPEN_SECONDS = 120;
const FAST_OPEN_IMAGE_SECONDS = 6;

/**
 * Lịch ảnh của video chương nội bộ: `FAST_OPEN_SECONDS` đầu chia ~6 giây/ảnh (20 ảnh), phần sau 1 ảnh/30 giây
 * (tối đa EPISODE_MAX_IMAGES). Trả mốc [start, end] liền nhau, phủ kín [0, seconds]; `zoom` = đoạn thuộc 2 phút đầu.
 * Chương ngắn hơn 2 phút thì cả chương theo nhịp nhanh.
 */
export function planChapterScenes(seconds: number) {
  const head = Math.min(FAST_OPEN_SECONDS, seconds);
  const headCount = Math.max(1, Math.round(head / FAST_OPEN_IMAGE_SECONDS));
  const rest = seconds - head;
  const restCount = rest > 0 ? Math.min(EPISODE_MAX_IMAGES, Math.max(1, Math.round(rest / EPISODE_IMAGE_SECONDS))) : 0;
  const slice = (from: number, span: number, count: number, zoom: boolean) =>
    Array.from({ length: count }, (_, i) => ({ start: from + (span * i) / count, end: i === count - 1 ? from + span : from + (span * (i + 1)) / count, zoom }));
  return [...slice(0, head, headCount, true), ...slice(head, rest, restCount, false)];
}

/** Số ảnh cho video chương: nội bộ (tập) 1 ảnh/30 giây, tối đa 80; thường 1 ảnh/25 giây, tối đa 30. Luôn ≥ 6. */
export function imageCount(seconds: number, episode: boolean) {
  const per = episode ? EPISODE_IMAGE_SECONDS : DEFAULT_IMAGE_SECONDS;
  return Math.min(episode ? EPISODE_MAX_IMAGES : DEFAULT_MAX_IMAGES, Math.max(MIN_IMAGES, Math.round(seconds / per)));
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
export function buildEpisodeToc(items: TocItem[], intro?: { seconds: number; title: string }) {
  const toc: { start: number; title: string }[] = [];
  // Đoạn mở đầu cao trào nằm trước chương đầu: mốc 00:00 là nó (YouTube bắt buộc chương đầu ở 00:00), các chương dời theo.
  let offset = intro && intro.seconds > 0 ? intro.seconds : 0;
  if (offset) toc.push({ start: 0, title: intro!.title });
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

/** Nhãn góc thumbnail kèm thời lượng: "FULL 1H30" (làm tròn 5 phút); dưới 5 phút lẻ thì "FULL 2H". */
export function fullBadge(seconds: number) {
  const totalMin = Math.max(60, Math.round(seconds / 300) * 5);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `FULL ${h}H${String(m).padStart(2, "0")}` : `FULL ${h}H`;
}

/** Tiêu đề luôn có nhãn tập (AI/vidIQ có thể bỏ): thiếu "Tập N" / "FULL" thì nối "| Tập N (Chương X–Y)"; cắt ≤ 100 ký tự. */
export function ensureEpisodeLabel(title: string, o: { episodeNo: number; from: number; to: number }) {
  const t = title.trim();
  if (/tập\s*\d+|full/i.test(t)) return t.length > 100 ? `${t.slice(0, 99)}…` : t;
  const tag = ` | Tập ${o.episodeNo} (Chương ${o.from}–${o.to})`;
  return `${t.slice(0, 100 - tag.length).trimEnd()}${tag}`;
}
