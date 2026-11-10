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
