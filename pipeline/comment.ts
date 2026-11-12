// Bình luận kêu gọi thích / chia sẻ / đăng ký, tự đăng dưới video sau khi video đã CÔNG KHAI.
//
// Vì sao không đăng ngay lúc upload: video lên lịch nằm ở chế độ private tới đúng giờ phát, mà YouTube
// không nhận bình luận vào video private → phải đợi video công khai rồi mới đăng (chạy trong lượt daily).
//
// GHIM bình luận: YouTube Data API KHÔNG có chức năng ghim (không endpoint, không trường nào trong
// commentThreads). Ghim chỉ làm tay được trong Studio / web. Ở đây chỉ tự ĐĂNG bình luận.
import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { escapeHtml, notify } from "@/lib/notify";
import { accessToken, getYoutubeAuth, noAngle } from "@/lib/youtube";
import { recordYoutubeUnits } from "@/lib/yt-units";
import { playlistUrl, seriesPlaylist } from "./playlist";
import { PUBLISH_HOUR_UTC } from "./schedule";

/** Giới hạn ký tự một bình luận YouTube. */
export const COMMENT_MAX = 10_000;

import { CHANNEL_URL } from "@/lib/channel";

/** Short đăng sau video dài 2 tiếng (publishToYoutube) — bình luận cũng phải đợi tới lúc đó. */
export const SHORT_DELAY_MS = 2 * 3600_000;

/**
 * Nội dung bình luận: lời kêu gọi + link trọn bộ + link đăng ký. Thiếu playlist thì bỏ hẳn dòng đó.
 * `short`: bản gọn cho Short — người lướt Shorts không đọc đoạn dài.
 */
export function ctaComment(o: { seriesTitle: string; episodeNo?: number; playlistUrl: string | null; channelUrl: string; publishHour: string; short?: boolean }): string {
  const what = o.episodeNo ? `tập ${o.episodeNo}` : "tập này";
  const lines = o.short
    ? [
        `THÍCH · CHIA SẺ nếu bạn thấy cuốn 🙏`,
        ...(o.playlistUrl ? [`📜 Nghe bản đầy đủ: ${o.playlistUrl}`] : []),
        `🔔 ĐĂNG KÝ — tập mới mỗi ngày ${o.publishHour}: ${o.channelUrl}?sub_confirmation=1`,
      ]
    : [
        `Nghe hết ${what} rồi thì để lại một lượt THÍCH và CHIA SẺ cho bạn bè cùng nghe nhé 🙏`,
        ...(o.playlistUrl ? [`📜 Nghe trọn bộ ${noAngle(o.seriesTitle)} theo thứ tự: ${o.playlistUrl}`] : []),
        `🔔 ĐĂNG KÝ kênh để không lỡ tập mới mỗi ngày lúc ${o.publishHour}: ${o.channelUrl}?sub_confirmation=1`,
      ];
  return noAngle(lines.join("\n")).slice(0, COMMENT_MAX);
}

export type CommentTarget = { youtubeId: string; kind: "long" | "short" };

/**
 * Video nào trong một row còn phải bình luận: video dài tính theo `publishAt`, Short của tập chậm hơn 2 tiếng.
 * Short cắt cảnh nằm ở row riêng (không có `youtubeVideoId`) nên dùng chính `publishAt` của nó.
 * Đã bình luận rồi (`commentedAt` / `shortCommentedAt`) thì bỏ qua — không đăng chồng.
 */
export function commentTargets(
  row: { youtubeVideoId: string | null; youtubeShortId: string | null; publishAt: Date | null; meta: { commentedAt?: string; shortCommentedAt?: string } | null },
  now: Date,
): CommentTarget[] {
  if (!row.publishAt || !row.meta) return [];
  const live = row.publishAt.getTime();
  const out: CommentTarget[] = [];
  if (row.youtubeVideoId && !row.meta.commentedAt && live <= now.getTime()) out.push({ youtubeId: row.youtubeVideoId, kind: "long" });
  // Row chỉ có Short (Short cắt cảnh): publishAt đã là giờ phát của chính Short, không cộng thêm.
  const shortLive = row.youtubeVideoId ? live + SHORT_DELAY_MS : live;
  if (row.youtubeShortId && !row.meta.shortCommentedAt && shortLive <= now.getTime()) out.push({ youtubeId: row.youtubeShortId, kind: "short" });
  return out;
}

/** Đăng một bình luận gốc dưới video. Trả lỗi dạng chuỗi thay vì ném — một bình luận hỏng không được làm đổ lượt daily. */
export async function postComment(token: string, youtubeId: string, text: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { videoId: youtubeId, topLevelComment: { snippet: { textOriginal: text } } } }),
  });
  await recordYoutubeUnits("commentInsert");
  return res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}`;
}

/**
 * Đăng bình luận kêu gọi cho mọi video ĐÃ tới giờ phát mà chưa có bình luận (`meta.commentedAt`).
 * Chạy trong lượt daily. Không bao giờ ném — lỗi chỉ ghi log.
 */
export async function commentOnPublished(now = new Date()): Promise<void> {
  const auth = await getYoutubeAuth().catch(() => null);
  if (!auth) return;
  const rows = await db()
    .select({
      id: videos.id, ytId: videos.youtubeVideoId, shortId: videos.youtubeShortId, publishAt: videos.publishAt,
      meta: videos.meta, seriesId: chapters.seriesId, seriesTitle: series.title,
    })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(isNotNull(videos.publishAt), lte(videos.publishAt, now)));
  const todo = rows
    .map((r) => ({ row: r, targets: commentTargets({ youtubeVideoId: r.ytId, youtubeShortId: r.shortId, publishAt: r.publishAt, meta: r.meta }, now) }))
    .filter((x) => x.targets.length);
  if (!todo.length) return;
  const token = await accessToken(auth.refreshToken);
  const pinLinks: string[] = [];
  for (const { row: r, targets } of todo) {
    const pl = await seriesPlaylist(r.seriesId).catch(() => null);
    for (const t of targets) {
      const text = ctaComment({
        seriesTitle: r.seriesTitle,
        episodeNo: r.meta!.compilation?.episodeNo,
        playlistUrl: pl ? playlistUrl(pl) : null,
        channelUrl: CHANNEL_URL,
        publishHour: `${PUBLISH_HOUR_UTC + 7}h`,
        short: t.kind === "short",
      });
      const err = await postComment(token, t.youtubeId, text);
      if (err) {
        console.warn(`  ⚠ Không bình luận được ${t.kind} của #${r.id} (youtu.be/${t.youtubeId}): ${err}`);
        continue;
      }
      const stamp = t.kind === "long" ? { commentedAt: new Date().toISOString() } : { shortCommentedAt: new Date().toISOString() };
      // Đọc lại meta từ biến đang có rồi gộp: 2 đích của cùng một row không ghi đè cờ của nhau.
      r.meta = { ...r.meta!, ...stamp };
      await db().update(videos).set({ meta: r.meta }).where(eq(videos.id, r.id));
      console.log(`  Đã bình luận ${t.kind} youtu.be/${t.youtubeId} — còn GHIM phải làm tay (API không có chức năng ghim)`);
      pinLinks.push(`${t.kind === "short" ? "Short" : "Tập"} ${escapeHtml(r.seriesTitle)}: https://www.youtube.com/watch?v=${t.youtubeId}`);
    }
  }
  // YouTube Data API không ghim được bình luận → gom một tin nhắn kèm link, ghim 1 chạm trong app/Studio.
  if (pinLinks.length) {
    await notify(`💬 <b>Đã đăng ${pinLinks.length} bình luận</b> — bấm vào GHIM giúp mình (API không ghim được):\n${pinLinks.join("\n")}`).catch(() => {});
  }
}
