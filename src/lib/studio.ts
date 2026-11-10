import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type Video } from "@/db/schema";
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

export type VideoKind = "episode" | "internal";

export async function videoCards(opts: { limit?: number; statuses?: Video["status"][]; kind?: VideoKind } = {}): Promise<VideoCard[]> {
  const isEpisode = sql`${videos.meta}->'compilation'->>'episode' = 'true'`;
  const isInternal = sql`${series.episodeChapters} > 0 and ${videos.meta}->'compilation' is null and ${videos.youtubeVideoId} is null`;
  const where = and(
    opts.statuses ? inArray(videos.status, opts.statuses) : undefined,
    opts.kind === "episode" ? isEpisode : opts.kind === "internal" ? isInternal : undefined,
  );
  const rows = await db()
    .select({ v: videos, chapterNo: chapters.number, chapterTitle: chapters.title, seriesTitle: series.title, episodeChapters: series.episodeChapters })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(where)
    .orderBy(desc(videos.id))
    .limit(opts.limit ?? 60);
  return rows.map(({ v, episodeChapters, ...r }) => ({
    id: v.id,
    status: v.status,
    uploadStatus: v.uploadStatus,
    error: v.error,
    durationSec: v.durationSec,
    publishAt: v.publishAt?.toISOString() ?? null,
    hasThumb: Boolean(v.assets["thumbnail.jpg"]),
    thumbVersion: v.assets["thumbnail.jpg"] ?? null,
    ytThumb: v.meta?.yt?.thumb ?? null,
    ytPrivacy: v.meta?.yt?.privacy ?? null,
    youtubeVideoId: v.youtubeVideoId,
    youtubeShortId: v.youtubeShortId,
    compilation: v.meta?.compilation ? { from: v.meta.compilation.from, to: v.meta.compilation.to, episodeNo: v.meta.compilation.episode ? (v.meta.compilation.episodeNo ?? null) : null } : null,
    internal: episodeChapters > 0 && !v.meta?.compilation && !v.youtubeVideoId,
    ...r,
    ...(v.status === "rendering" ? liveSummary(v.progress) : { live: null, pct: null }),
  }));
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
