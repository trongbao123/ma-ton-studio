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
import { channelProfile } from "@/lib/channel-profile";
import { accessToken, channelUrlOf, getYoutubeAuth, noAngle } from "@/lib/youtube";
import { recordYoutubeUnits } from "@/lib/yt-units";
import { playlistUrl, seriesPlaylist } from "./playlist";
import { PUBLISH_HOUR_UTC } from "./schedule";

/** Giới hạn ký tự một bình luận YouTube. */
export const COMMENT_MAX = 10_000;


/** Short đăng sau video dài 2 tiếng (publishToYoutube) — bình luận cũng phải đợi tới lúc đó. */
export const SHORT_DELAY_MS = 2 * 3600_000;

export type CtaCommentInput = {
  seriesTitle: string; episodeNo?: number; playlistUrl: string | null; channelUrl: string; publishHour: string; short?: boolean; cadence?: string; history?: boolean;
};

/**
 * Nội dung bình luận: lời kêu gọi + link trọn bộ + link đăng ký. Thiếu playlist thì bỏ hẳn dòng đó.
 * `short`: bản gọn cho Short — người lướt Shorts không đọc đoạn dài.
 * `cadence`: có = kênh truyện độc lập (chuyện đời/lịch sử) — nhịp đăng lấy từ hồ sơ kênh.
 * `history`: true = kênh lịch sử — câu chữ "phim tài liệu" (hỏi sự kiện/nhân vật muốn xem tiếp), KHÔNG dùng
 * câu "câu chuyện"/"chạm lòng" của kênh chuyện đời (phim tài liệu không phải chuyện kể đời tư).
 */
export function ctaComment(o: CtaCommentInput): string {
  if (o.history) {
    const lines = o.short
      ? [`Thấy hay thì THÍCH · CHIA SẺ giúp kênh nhé 🙏`, ...(o.playlistUrl ? [`📜 Xem thêm video lịch sử khác: ${o.playlistUrl}`] : []), `🔔 ĐĂNG KÝ — ${o.cadence}: ${o.channelUrl}?sub_confirmation=1`]
      : [
          `Nếu video này hay, để lại một lượt THÍCH và CHIA SẺ giúp kênh nhé 🙏`,
          `Bạn muốn xem tiếp sự kiện hay nhân vật lịch sử nào? Để lại dưới bình luận nhé.`,
          ...(o.playlistUrl ? [`📜 Xem thêm video lịch sử khác: ${o.playlistUrl}`] : []),
          `🔔 ĐĂNG KÝ kênh để không lỡ ${o.cadence}: ${o.channelUrl}?sub_confirmation=1`,
        ];
    return noAngle(lines.join("\n")).slice(0, COMMENT_MAX);
  }
  if (o.cadence) {
    const lines = o.short
      ? [`Thấy chạm lòng thì THÍCH · CHIA SẺ giúp kênh nhé 🙏`, ...(o.playlistUrl ? [`📜 Nghe trọn câu chuyện: ${o.playlistUrl}`] : []), `🔔 ĐĂNG KÝ — ${o.cadence}: ${o.channelUrl}?sub_confirmation=1`]
      : [
          `Nếu câu chuyện này chạm tới bạn, để lại một lượt THÍCH và CHIA SẺ cho người thân cùng nghe nhé 🙏`,
          `Bạn đã từng gặp chuyện giống vậy chưa? Kể cho mọi người nghe dưới bình luận nhé.`,
          ...(o.playlistUrl ? [`📜 Nghe thêm những câu chuyện khác: ${o.playlistUrl}`] : []),
          `🔔 ĐĂNG KÝ kênh để không lỡ ${o.cadence}: ${o.channelUrl}?sub_confirmation=1`,
        ];
    return noAngle(lines.join("\n")).slice(0, COMMENT_MAX);
  }
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
  const rows = await db()
    .select({
      id: videos.id, ytId: videos.youtubeVideoId, shortId: videos.youtubeShortId, publishAt: videos.publishAt,
      meta: videos.meta, seriesId: chapters.seriesId, seriesTitle: series.title, channel: series.channel,
    })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(isNotNull(videos.publishAt), lte(videos.publishAt, now)));
  const todo = rows
    .map((r) => ({ row: r, targets: commentTargets({ youtubeVideoId: r.ytId, youtubeShortId: r.shortId, publishAt: r.publishAt, meta: r.meta }, now) }))
    .filter((x) => x.targets.length);
  if (!todo.length) return;
  // Mỗi kênh bình luận bằng chính tài khoản kênh đó; kênh chưa kết nối thì bỏ qua.
  const tokens = new Map<string, { token: string; url: string } | null>();
  const tokenOf = async (ch: string) => {
    if (!tokens.has(ch)) {
      const auth = await getYoutubeAuth(ch).catch(() => null);
      tokens.set(ch, auth ? { token: await accessToken(auth.refreshToken), url: await channelUrlOf(ch) } : null);
    }
    return tokens.get(ch)!;
  };
  const pinLinks: string[] = [];
  for (const { row: r, targets } of todo) {
    const acc = await tokenOf(r.channel).catch(() => null);
    if (!acc) continue;
    const token = acc.token;
    const pl = await seriesPlaylist(r.seriesId).catch(() => null);
    for (const t of targets) {
      const text = ctaComment({
        seriesTitle: r.seriesTitle,
        episodeNo: r.meta!.compilation?.episodeNo,
        playlistUrl: pl ? playlistUrl(pl) : null,
        channelUrl: acc.url,
        publishHour: `${PUBLISH_HOUR_UTC + 7}h`,
        ...(r.channel !== "main" ? { cadence: channelProfile(r.channel).cadence, history: r.channel === "lich-su" } : {}),
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

export type CreditCommentRow = { id: number; youtubeVideoId: string | null; publishAt: Date | null; meta: { overflowCredits?: string[]; creditsCommentedAt?: string } | null };

/**
 * Video đã công khai (publishAt <= now), có id YouTube, còn ghi công ảnh dư (lịch sử: `meta.overflowCredits` —
 * ảnh không vừa mô tả) chưa đăng bình luận (`meta.creditsCommentedAt`). Lúc hoàn tất (`historyAuto`) video còn
 * riêng tư tới đúng giờ phát nên không đăng được ngay — phải đợi tới đây.
 */
export function creditCommentTargets<T extends CreditCommentRow>(rows: T[], now: Date): T[] {
  return rows.filter(
    (r) => r.youtubeVideoId && r.publishAt && r.publishAt.getTime() <= now.getTime() && (r.meta?.overflowCredits?.length ?? 0) > 0 && !r.meta?.creditsCommentedAt,
  );
}

/** Chia các dòng ghi công thành nhiều đoạn, mỗi đoạn không vượt `maxBytes` — dùng cho cả bình luận YouTube (`COMMENT_MAX`) và tin Telegram báo lỗi. */
export function chunkCreditLines(lines: string[], maxBytes: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (current.length && currentBytes + lineBytes > maxBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(line);
    currentBytes += lineBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const OVERFLOW_CREDIT_HEADER = "Ghi công ảnh tư liệu (không đủ chỗ trong mô tả):";
/** Chừa chỗ cho header + số thứ tự đoạn khi chia bình luận ghi công dài. */
const OVERFLOW_CREDIT_HEADER_MARGIN = 50;
/** Ngân sách mỗi tin Telegram báo ghi công lỗi — chừa chỗ cho tiêu đề + escape HTML giãn chuỗi (&,<,>). */
const TELEGRAM_CREDIT_CHUNK_BYTES = 3000;

/** Đăng đủ các dòng ghi công (không chia nhỏ mất nội dung) thành 1+ bình luận; đoạn nào lỗi thì trả lỗi đó luôn, không thử các đoạn còn lại (thử lại từ đầu ở lượt sau). */
async function postCreditLines(token: string, youtubeId: string, lines: string[]): Promise<string | null> {
  const chunks = chunkCreditLines(lines, COMMENT_MAX - Buffer.byteLength(OVERFLOW_CREDIT_HEADER, "utf8") - OVERFLOW_CREDIT_HEADER_MARGIN);
  for (const [i, chunk] of chunks.entries()) {
    const text = `${OVERFLOW_CREDIT_HEADER}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ""}\n${chunk.join("\n")}`;
    const err = await postComment(token, youtubeId, text);
    if (err) return err;
  }
  return null;
}

/**
 * Báo Telegram đủ nội dung ghi công chưa đăng được — CẮT chuỗi TRƯỚC rồi mới escape HTML (escape trước rồi cắt
 * dễ cắt giữa một thực thể `&amp;`/`&lt;`, lộ ký tự thô); chia nhiều tin nếu dài thay vì bớt nội dung.
 */
async function notifyCreditLinesFailed(videoId: number, reason: string, lines: string[]) {
  const chunks = chunkCreditLines(lines, TELEGRAM_CREDIT_CHUNK_BYTES);
  for (const [i, chunk] of chunks.entries()) {
    const part = chunks.length > 1 ? ` (phần ${i + 1}/${chunks.length})` : "";
    await notify(`⚠️ Video lịch sử #${videoId}: đăng bình luận ghi công ảnh lỗi (${escapeHtml(reason)})${part} — ghi công tay giúp:\n${escapeHtml(chunk.join("\n"))}`);
  }
}

/**
 * Đăng bù bình luận ghi công ảnh dư (lịch sử, `meta.overflowCredits`) cho video ĐÃ công khai — lúc hoàn tất
 * (`historyAuto`, pipeline/history-script.ts) video còn riêng tư tới đúng giờ phát nên YouTube không nhận bình
 * luận; gọi hàm này trong lượt daily, ngay sau `commentOnPublished`. Lỗi chỉ báo Telegram ở LẦN ĐẦU (đóng dấu
 * `meta.creditsCommentAttempts`) để không spam mỗi lượt daily (~3 giờ/lần).
 */
export async function postPendingCreditComments(now = new Date()): Promise<void> {
  const rows = await db()
    .select({ id: videos.id, youtubeVideoId: videos.youtubeVideoId, publishAt: videos.publishAt, meta: videos.meta, channel: series.channel })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(isNotNull(videos.youtubeVideoId), isNotNull(videos.publishAt), lte(videos.publishAt, now)));
  for (const r of creditCommentTargets(rows, now)) {
    const lines = r.meta!.overflowCredits!;
    const auth = await getYoutubeAuth(r.channel).catch(() => null);
    const err = auth ? await postCreditLines(await accessToken(auth.refreshToken), r.youtubeVideoId!, lines) : "Chưa kết nối YouTube";
    if (!err) {
      await db().update(videos).set({ meta: { ...r.meta!, creditsCommentedAt: new Date().toISOString() } }).where(eq(videos.id, r.id));
      console.log(`  Đã đăng bình luận ghi công ảnh dư cho video #${r.id}`);
      continue;
    }
    const attempts = (r.meta!.creditsCommentAttempts ?? 0) + 1;
    await db().update(videos).set({ meta: { ...r.meta!, creditsCommentAttempts: attempts } }).where(eq(videos.id, r.id));
    console.warn(`  ⚠ Không đăng được bình luận ghi công ảnh dư cho video #${r.id}: ${err}`);
    if (attempts === 1) await notifyCreditLinesFailed(r.id, err, lines);
  }
}
