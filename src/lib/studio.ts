import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type Video, type VideoMeta } from "@/db/schema";
import { TITLES, type NodeId } from "@/lib/flow/model";
import type { VideoProgress } from "@/lib/flow/progress";

export type SeriesCard = {
  id: number;
  title: string;
  genre: string;
  autopilot: boolean;
  total: number;
  pending: number;
  approved: number;
  /** Video mới nhất có thumbnail — làm bìa truyện. */
  coverVideoId: number | null;
  /** Id asset của thumbnail bìa — đưa vào URL để cache ảnh lâu dài. */
  coverVersion: number | null;
};

export async function seriesCards(): Promise<SeriesCard[]> {
  const rows = await db()
    .select({
      id: series.id,
      title: series.title,
      genre: series.genre,
      autopilot: series.autopilot,
      total: count(chapters.id),
      pending: sql<number>`count(*) filter (where ${chapters.status} = 'draft')`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${chapters.status} = 'approved')`.mapWith(Number),
    })
    .from(series)
    .leftJoin(chapters, eq(chapters.seriesId, series.id))
    .groupBy(series.id)
    .orderBy(desc(series.createdAt));
  const covers = await db()
    .selectDistinctOn([chapters.seriesId], { seriesId: chapters.seriesId, id: videos.id, assets: videos.assets })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(sql`${videos.assets} ? 'thumbnail.jpg'`)
    .orderBy(chapters.seriesId, desc(videos.id));
  const cover = new Map(covers.map((c) => [c.seriesId, c]));
  return rows.map((r) => ({ ...r, coverVideoId: cover.get(r.id)?.id ?? null, coverVersion: cover.get(r.id)?.assets["thumbnail.jpg"] ?? null }));
}

export type VideoCard = {
  id: number;
  status: Video["status"];
  uploadStatus: Video["uploadStatus"];
  error: string | null;
  durationSec: number | null;
  publishAt: string | null;
  hasThumb: boolean;
  /** File làm bìa: thumbnail.jpg, hoặc ảnh cảnh đầu (chương nội bộ). */
  thumbFile: string;
  /** Id asset của thumbnail (null = chưa có). */
  thumbVersion: number | null;
  /** Thumbnail đang dùng trên YouTube (đồng bộ về) — ưu tiên hơn ảnh app dựng, vì người dùng hay đổi tay. */
  ytThumb: string | null;
  /** public / private / unlisted theo YouTube (null = chưa đồng bộ). */
  ytPrivacy: string | null;
  chapterNo: number;
  chapterTitle: string;
  seriesTitle: string;
  /** Có = bản gộp chương from–to (chapterNo = chương cuối). */
  compilation: { from: number; to: number; episodeNo: number | null } | null;
  /** Video chương nội bộ của chế độ tập (nguyên liệu ghép, không đăng lẻ). */
  internal: boolean;
  /** Có = Short cắt cảnh từ một chương (row riêng): tiêu đề Short và điểm vidIQ của nó. */
  shortClip: { title: string; score: number | null } | null;
  /** Bước đang chạy, vd "Vẽ ảnh cảnh 18/30" — chỉ có với pipeline ghi tiến độ. */
  live: string | null;
  /** 0–1, tiến độ cả video khi đang render. */
  pct: number | null;
  /** Id video YouTube (dài / Short) để hiện lượt xem — null khi chưa đăng. */
  youtubeVideoId: string | null;
  youtubeShortId: string | null;
};

const RENDER: NodeId[] = ["agent", "tts", "images", "video"];

/** Tóm tắt tiến độ cho thẻ video: bước đang chạy + % chung (mỗi bước render là 1/4). */
export function liveSummary(p: VideoProgress | null | undefined): { live: string | null; pct: number | null } {
  const steps = p?.steps ?? {};
  if (!Object.keys(steps).length) return { live: null, pct: null };
  let pct = 0;
  let live: string | null = null;
  for (const id of RENDER) {
    const s = steps[id];
    if (!s) continue;
    const parts = [s.long, s.short].filter((x) => x && x.total > 0) as { done: number; total: number }[];
    const frac = s.state === "done" || s.state === "skip" ? 1 : parts.length ? parts.reduce((a, x) => a + x.done, 0) / parts.reduce((a, x) => a + x.total, 0) : 0;
    pct += frac / RENDER.length;
    if (s.state === "run" && !live) live = s.long ? `${TITLES[id]} ${s.long.done}/${s.long.total}` : TITLES[id];
  }
  return { live, pct };
}

export type VideoKind = "episode" | "internal" | "short";

/** Ảnh bìa thẻ: thumbnail; chương nội bộ không có thumbnail thì lấy ảnh cảnh đầu tiên đã vẽ (long-img-N.jpg nhỏ nhất). */
export function coverOf(assets: Record<string, number>): { file: string; version: number } | null {
  if (assets["thumbnail.jpg"]) return { file: "thumbnail.jpg", version: assets["thumbnail.jpg"] };
  const scene = Object.keys(assets)
    .map((f) => ({ f, n: Number(f.match(/^long-img-(\d+)\.jpg$/)?.[1] ?? NaN) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n)[0];
  return scene ? { file: scene.f, version: assets[scene.f] } : null;
}

type VideoFilter = { statuses?: Video["status"][]; kind?: VideoKind; q?: string };

/** Điều kiện lọc dùng chung cho danh sách và đếm tổng (phân trang). */
function videoWhere(opts: VideoFilter) {
  const isEpisode = sql`${videos.meta}->'compilation'->>'episode' = 'true'`;
  const isShortClip = sql`${videos.meta}->'shortClip' is not null`;
  const isInternal = sql`${series.episodeChapters} > 0 and ${videos.meta}->'compilation' is null and ${videos.meta}->'shortClip' is null and ${videos.youtubeVideoId} is null`;
  // Tìm theo tên chương / tên truyện / tiêu đề YouTube / số chương ("12" hoặc "chương 12").
  const q = opts.q?.trim();
  const num = q?.match(/^(?:ch(?:ương|uong)?\s*)?(\d+)$/i)?.[1];
  const search = q
    ? num
      ? eq(chapters.number, Number(num))
      : sql`(${chapters.title} ilike ${`%${q}%`} or ${series.title} ilike ${`%${q}%`} or ${videos.meta}->>'title' ilike ${`%${q}%`})`
    : undefined;
  const where = and(
    search,
    opts.statuses ? inArray(videos.status, opts.statuses) : undefined,
    opts.kind === "episode" ? isEpisode : opts.kind === "internal" ? isInternal : opts.kind === "short" ? isShortClip : undefined,
  );
  return where;
}

/** Tổng số video khớp bộ lọc — để hiện số trang. */
export async function videoCount(opts: VideoFilter = {}) {
  const [r] = await db()
    .select({ n: count() })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(videoWhere(opts));
  return r?.n ?? 0;
}

export async function videoCards(
  opts: { limit?: number; offset?: number; statuses?: Video["status"][]; kind?: VideoKind; q?: string } = {},
): Promise<VideoCard[]> {
  const where = videoWhere(opts);
  const rows = await db()
    .select({
      id: videos.id, status: videos.status, uploadStatus: videos.uploadStatus, error: videos.error,
      durationSec: videos.durationSec, publishAt: videos.publishAt, assets: videos.assets,
      youtubeVideoId: videos.youtubeVideoId, youtubeShortId: videos.youtubeShortId,
      // Chỉ lấy vài khoá của `meta` (cả blob có mô tả 5000 ký tự, tags, titleOptions… mà thẻ không dùng).
      meta: sql<VideoCardMeta | null>`case when ${videos.meta} is null then null else jsonb_build_object(
        'title', ${videos.meta}->'title', 'shortTitle', ${videos.meta}->'shortTitle',
        'yt', ${videos.meta}->'yt', 'compilation', ${videos.meta}->'compilation', 'shortClip', ${videos.meta}->'shortClip') end`,
      // `progress` là cột NẶNG NHẤT (cảnh, prompt, nhật ký, clip i2v) và chỉ dùng cho video đang render
      // → chỉ kéo về đúng những dòng đó, còn lại trả null. Trước đây kéo cả blob cho mọi dòng của mọi trang.
      progress: sql<VideoProgress | null>`case when ${videos.status} = 'rendering' then ${videos.progress} else null end`,
      chapterNo: chapters.number, chapterTitle: chapters.title, seriesTitle: series.title, episodeChapters: series.episodeChapters,
    })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(where)
    .orderBy(desc(videos.id))
    .limit(opts.limit ?? 60)
    .offset(opts.offset ?? 0);
  return rows.map(toVideoCard);
}

/** Phần `meta` mà thẻ video thật sự dùng — xem jsonb_build_object trong videoCards. */
export type VideoCardMeta = Pick<VideoMeta, "title" | "shortTitle" | "yt" | "compilation" | "shortClip">;

export type VideoCardRow = {
  id: number; status: Video["status"]; uploadStatus: Video["uploadStatus"]; error: string | null;
  durationSec: number | null; publishAt: Date | null; assets: Record<string, number>;
  youtubeVideoId: string | null; youtubeShortId: string | null;
  meta: VideoCardMeta | null; progress: VideoProgress | null;
  chapterNo: number; chapterTitle: string; seriesTitle: string; episodeChapters: number;
};

/** Dòng truy vấn → thẻ hiện trên trang. Thuần, để test được mà không cần DB. */
export function toVideoCard({ episodeChapters, meta, progress, assets, ...v }: VideoCardRow): VideoCard {
  const cover = coverOf(assets);
  return {
    id: v.id,
    status: v.status,
    uploadStatus: v.uploadStatus,
    error: v.error,
    durationSec: v.durationSec,
    publishAt: v.publishAt?.toISOString() ?? null,
    hasThumb: Boolean(cover),
    thumbFile: cover?.file ?? "thumbnail.jpg",
    thumbVersion: cover?.version ?? null,
    ytThumb: meta?.yt?.thumb ?? null,
    ytPrivacy: meta?.yt?.privacy ?? null,
    youtubeVideoId: v.youtubeVideoId,
    youtubeShortId: v.youtubeShortId,
    compilation: meta?.compilation ? { from: meta.compilation.from, to: meta.compilation.to, episodeNo: meta.compilation.episode ? (meta.compilation.episodeNo ?? null) : null } : null,
    internal: episodeChapters > 0 && !meta?.compilation && !meta?.shortClip && !v.youtubeVideoId,
    shortClip: meta?.shortClip ? { title: meta.shortTitle || meta.title, score: meta.shortClip.scoreTitle } : null,
    chapterNo: v.chapterNo,
    chapterTitle: v.chapterTitle,
    seriesTitle: v.seriesTitle,
    ...(v.status === "rendering" ? liveSummary(progress) : { live: null, pct: null }),
  };
}

/** Việc đang chờ người dùng: chương chờ duyệt, video lỗi/upload lỗi. */
export async function todo() {
  const [drafts, broken] = await Promise.all([
    db()
      .select({ id: chapters.id, number: chapters.number, title: chapters.title, seriesTitle: series.title })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(chapters.status, "draft"))
      .orderBy(desc(chapters.updatedAt))
      .limit(8),
    db()
      .select({ id: videos.id, status: videos.status, uploadStatus: videos.uploadStatus, error: videos.error, uploadError: videos.uploadError, chapterNo: chapters.number, seriesTitle: series.title })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(sql`${videos.status} = 'failed' or ${videos.uploadStatus} = 'failed'`)
      .orderBy(desc(videos.id))
      .limit(8),
  ]);
  return { drafts, broken };
}

/** Đếm nhanh cho dòng số liệu đầu trang. */
export async function counters() {
  const [[row], [{ drafts }]] = await Promise.all([
    db()
      .select({
        rendering: sql<number>`count(*) filter (where ${videos.status} in ('queued','rendering'))`.mapWith(Number),
        ready: sql<number>`count(*) filter (where ${videos.status} = 'ready')`.mapWith(Number),
        scheduled: sql<number>`count(*) filter (where ${videos.uploadStatus} = 'scheduled' and ${videos.publishAt} > now())`.mapWith(Number),
        published: sql<number>`count(*) filter (where ${videos.status} = 'published')`.mapWith(Number),
      })
      .from(videos),
    db().select({ drafts: count() }).from(chapters).where(eq(chapters.status, "draft")),
  ]);
  return { ...row, drafts };
}
