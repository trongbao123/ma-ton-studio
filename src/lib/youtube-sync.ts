import type { VideoMeta } from "@/db/schema";

/** Tiêu đề / mô tả / tag đang thật sự nằm trên YouTube (snippet của videos.list). */
export type YtSnippet = { title: string; description: string; tags: string[] };

const same = (a: string, b: string) => a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/**
 * Gộp bản trên YouTube vào meta trong DB — YouTube là bản đúng (người dùng hay sửa tay trong Studio / vidIQ).
 * `long`: tiêu đề, mô tả, tag của video dài; `short`: tiêu đề + mô tả Short (tag Short không đè tag video dài).
 * Trả null nếu không có gì khác. Đổi tiêu đề thì bỏ điểm vidIQ cũ (điểm đó là của tiêu đề trước).
 */
export function mergeSnippet(meta: VideoMeta, sn: YtSnippet, kind: "long" | "short"): VideoMeta | null {
  if (kind === "short") {
    if (same(meta.shortTitle, sn.title) && same(meta.shortDescription, sn.description)) return null;
    return { ...meta, shortTitle: sn.title, shortDescription: sn.description };
  }
  const titleChanged = !same(meta.title, sn.title);
  if (!titleChanged && same(meta.description, sn.description) && sameTags(meta.tags, sn.tags)) return null;
  return {
    ...meta,
    title: sn.title,
    description: sn.description,
    tags: sn.tags,
    ...(titleChanged && meta.seo ? { seo: { ...meta.seo, titleScore: null } } : {}),
  };
}

/** Id video từ link YouTube (watch?v=, youtu.be/, shorts/) — cho video đăng tay chỉ lưu youtubeUrl. */
export function youtubeIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

/** Những gì videos.list (part=snippet,status) cho biết về 1 video — tất cả đều là bản đúng hơn DB. */
export type YtInfo = {
  snippet: YtSnippet;
  /** Ảnh thumbnail đang dùng trên YouTube (kể cả thumbnail đổi tay), kèm ?v= để trình duyệt không giữ ảnh cũ. */
  thumb: string | null;
  privacy: string | null;
  /** status.publishAt: giờ hẹn đăng (video riêng tư có lịch). */
  scheduledAt: string | null;
  /** snippet.publishedAt: giờ công khai thật (video public). */
  publishedAt: string | null;
};

/** Giờ đăng thật theo YouTube: public → lúc công khai; riêng tư có hẹn → giờ hẹn; còn lại không biết (giữ DB). */
export function youtubePublishAt(info: Pick<YtInfo, "privacy" | "scheduledAt" | "publishedAt">): Date | null {
  if (info.privacy === "public" && info.publishedAt) return new Date(info.publishedAt);
  if (info.privacy === "private" && info.scheduledAt) return new Date(info.scheduledAt);
  return null;
}

type Thumbs = Partial<Record<"maxres" | "standard" | "high" | "medium" | "default", { url?: string }>>;

/** Ảnh 16:9 nét nhất có (maxres/standard; high/medium là bản 4:3 có viền đen thì để sau). */
export function bestThumb(t: Thumbs | undefined, version: string | undefined): string | null {
  const url = t?.maxres?.url ?? t?.standard?.url ?? t?.medium?.url ?? t?.high?.url ?? t?.default?.url;
  if (!url) return null;
  return version ? `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version.slice(-12))}` : url;
}

export type YtPatch = { meta?: VideoMeta; publishAt?: Date; youtubeVideoId?: string };

/**
 * Thay đổi cần ghi vào 1 dòng videos theo bản YouTube: tiêu đề/mô tả/tag (video dài) hoặc tiêu đề/mô tả Short,
 * thumbnail + trạng thái đăng, giờ đăng thật, và id video dài nếu dòng chỉ lưu youtubeUrl (video đăng tay).
 */
export function youtubePatch(
  row: { meta: VideoMeta; publishAt: Date | null; youtubeVideoId: string | null },
  long: { id: string; info: YtInfo } | null,
  short: YtInfo | null,
): YtPatch | null {
  let meta = row.meta;
  const patch: YtPatch = {};
  if (long) {
    meta = mergeSnippet(meta, long.info.snippet, "long") ?? meta;
    const yt = { thumb: long.info.thumb, privacy: long.info.privacy };
    if (meta.yt?.thumb !== yt.thumb || meta.yt?.privacy !== yt.privacy) meta = { ...meta, yt };
    const at = youtubePublishAt(long.info);
    if (at && at.getTime() !== row.publishAt?.getTime()) patch.publishAt = at;
    if (!row.youtubeVideoId) patch.youtubeVideoId = long.id;
  }
  if (short) meta = mergeSnippet(meta, short.snippet, "short") ?? meta;
  if (meta !== row.meta) patch.meta = meta;
  return Object.keys(patch).length ? patch : null;
}
