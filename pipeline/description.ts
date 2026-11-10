// Làm dày mô tả YouTube theo checklist vidIQ: mục lục có mốc thời gian (YouTube chapters), link danh sách phát / chương trước,
// hashtag — những thứ AI viết mô tả không tự có nên vidIQ chấm mô tả rất thấp (33/100).
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chapters, videos, type VideoMeta } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { AI_NOTE } from "@/lib/seo-optimize";
import { formatTimestamp } from "./compile-plan";
import type { Cue } from "./text";

const CHANNEL_URL = process.env.YOUTUBE_CHANNEL_URL ?? "https://www.youtube.com/@MaTonTruyen";

export type Segment = { start: number; text: string };

/** Số mốc: ~1 mốc / 3 phút, 4–8 mốc (YouTube cần ≥ 3 mốc, mốc đầu 00:00, mỗi đoạn ≥ 10 giây). */
export const segmentCount = (seconds: number) => Math.min(8, Math.max(4, Math.round(seconds / 180)));

/** Chia theo phụ đề thật của giọng đọc — mốc thời gian khớp đúng chỗ đang đọc. */
export function segmentsFromCues(cues: Cue[], total: number): Segment[] {
  const n = segmentCount(total);
  return Array.from({ length: n }, (_, i) => {
    const from = (total * i) / n;
    const to = (total * (i + 1)) / n;
    const first = cues.find((c) => c.start >= from);
    return {
      start: i === 0 ? 0 : Math.floor(first?.start ?? from),
      text: cues.filter((c) => c.start >= from && c.start < to).map((c) => c.text).join(" "),
    };
  });
}

/** Video đã đăng không còn phụ đề: chia nội dung chương theo tỉ lệ ký tự (giọng đọc đều nên lệch ít). */
export function segmentsFromText(content: string, total: number): Segment[] {
  const n = segmentCount(total);
  const len = content.length;
  return Array.from({ length: n }, (_, i) => ({
    start: Math.floor((total * i) / n),
    text: content.slice(Math.floor((len * i) / n), Math.floor((len * (i + 1)) / n)),
  }));
}

/** Tên ngắn cho từng đoạn (3–8 chữ, gây tò mò, không spoil kết) — model rẻ. */
export async function headings(segments: Segment[]): Promise<string[]> {
  const { titles } = await textProvider().generateJson({
    system: "Bạn đặt tên mục lục (YouTube chapters) cho video truyện audio tiên hiệp.",
    prompt: `Đặt tên cho ${segments.length} đoạn dưới đây, mỗi tên 3–8 chữ tiếng Việt, gây tò mò, không spoil kết, không đánh số.\n\n${segments
      .map((s, i) => `${i + 1}. ${s.text.slice(0, 500)}`)
      .join("\n\n")}`,
    schema: z.object({ titles: z.array(z.string()) }),
    tier: "cheap",
    task: "summary",
  });
  return segments.map((_, i) => (i === 0 ? "Mở đầu" : (titles[i] ?? `Phần ${i + 1}`)).replace(/\s+/g, " ").trim());
}

/** Link YouTube chương 1 + chương liền trước (đã đăng) của cùng bộ truyện. */
async function chapterLinks(seriesId: number, chapterNumber: number) {
  const rows = await db()
    .select({ number: chapters.number, url: videos.youtubeUrl, meta: videos.meta })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(and(eq(chapters.seriesId, seriesId), lt(chapters.number, chapterNumber), isNotNull(videos.youtubeUrl)));
  const single = rows.filter((r) => !r.meta?.compilation);
  const at = (n: number) => single.find((r) => r.number === n)?.url;
  const prev = at(chapterNumber - 1);
  const first = chapterNumber > 2 ? at(1) : undefined;
  return [first && `▶ Nghe từ chương 1: ${first}`, prev && `⏮ Chương ${chapterNumber - 1}: ${prev}`].filter(Boolean) as string[];
}

/** Ghép mô tả: thân bài AI + mục lục + link + hashtag + ghi chú AI + ghi công nhạc. Thuần — để test. */
export function composeDescription(body: string, toc: { start: number; title: string }[], links: string[], hashtags: string[], tail: string) {
  const clean = body.replace(AI_NOTE, "").trim();
  const parts = [clean];
  if (toc.length >= 3) parts.push(`⏱ MỤC LỤC\n${toc.map((t) => `${formatTimestamp(t.start)} ${t.title}`).join("\n")}`);
  parts.push([...links, `🔔 Đăng ký kênh để nghe chương mới mỗi ngày: ${CHANNEL_URL}?sub_confirmation=1`].join("\n"));
  const missing = hashtags.filter((h) => !clean.toLowerCase().includes(h.toLowerCase()));
  if (missing.length) parts.push(missing.join(" "));
  parts.push(AI_NOTE);
  if (tail.trim()) parts.push(tail.trim());
  return parts.join("\n\n");
}

/** Bỏ phần đã ghép trước đó (mục lục / link / ghi công) để chạy lại không bị nhân đôi. */
export function splitBody(description: string) {
  const credit = description.match(/\n\nNhạc nền:[\s\S]*$/)?.[0] ?? "";
  const body = description.replace(credit, "").split(/\n\n⏱ MỤC LỤC/)[0].replace(AI_NOTE, "").trim();
  return { body, credit };
}

const hashtagOf = (k: string) => `#${k.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]/g, "")}`;

/** 3–5 hashtag: 3 cố định của kênh + 2 từ khóa tìm kiếm đầu. */
export function hashtagsFor(keywords?: string[]) {
  return ["#TruyenAudio", "#TruyenTuTien", "#TienHiep", ...(keywords ?? []).slice(0, 2).map(hashtagOf)]
    .filter((h, i, a) => h.length > 3 && a.indexOf(h) === i)
    .slice(0, 5);
}

/** Mô tả đủ mục lục + link + hashtag. `links` thêm từ ngoài (vd danh sách phát). Lỗi AI/DB thì bỏ phần đó, không chặn render. */
export async function enrichDescription(
  meta: VideoMeta,
  o: { segments: Segment[]; seriesId: number; chapterNumber: number; keywords?: string[]; links?: string[] },
): Promise<VideoMeta> {
  const { body, credit } = splitBody(meta.description);
  const toc = await headings(o.segments)
    .then((t) => o.segments.map((s, i) => ({ start: s.start, title: t[i] })))
    .catch(() => []);
  const links = [...(o.links ?? []), ...(await chapterLinks(o.seriesId, o.chapterNumber).catch(() => []))];
  const hashtags = hashtagsFor(o.keywords);
  return { ...meta, description: composeDescription(body, toc, links, hashtags, credit) };
}
