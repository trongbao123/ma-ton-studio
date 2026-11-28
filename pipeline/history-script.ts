// Viết một kịch bản lịch sử (CLI: render.ts "historyscript:<seriesId>"): đề tài kế tiếp → gom hồ sơ → viết nhiều lượt → soát sự thật.
// historyAuto (CLI: "historyauto:<seriesId>") là trọn vòng tự chạy, MỖI LƯỢT CHỈ LÀM MỘT VIỆC NẶNG theo thứ tự ưu
// tiên (daily.ts dispatch job riêng ~3 giờ/lần vì dựng tới 4,5 giờ): (a) có video đã dựng xong (ready), chưa đăng,
// VÀ đăng được ngay → chỉ hoàn tất (meta/thumbnail/đăng); (b) có video đang xếp hàng (queued) → claim + dựng (+
// hoàn tất nếu đạt); (c) kho chờ đăng đã đủ → thôi; (d) hết thì viết đề tài mới rồi xếp hàng, để lượt daily kế tiếp dựng.
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, videos, type Chapter, type Series, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { loadSecrets } from "@/lib/secrets";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { FactCheckFailedError } from "@/lib/story/fact-check";
import { isHistoryStory, pickChapterToWrite } from "@/lib/story/history";
import { maxContinues } from "@/lib/story/prompts";
import { getChapter, getSeries, writeChapterStep } from "@/lib/story/service";
import { WIKI_USER_AGENT } from "@/lib/story/wiki-api";
import { accessToken, getYoutubeAuth } from "@/lib/youtube";
import { COMMENT_MAX, postComment } from "./comment";
import { historyVideoMeta, pickThumbnailImage } from "./history-meta";
import { ensureRelease, uploadAsset } from "./release";
import { thumbnail } from "./render";
import { keepOrNextSlot } from "./schedule";
import type { ArtImage } from "./scene-art";
import { autoPublishEligible, publishToYoutube } from "./youtube";

const run = promisify(execFile);

/** Ảnh dùng để ghi công/thumbnail + nhạc đã dùng khi dựng một video lịch sử. */
type HistoryCredits = { images: ArtImage[]; musicFiles: string[] };

/** Lý do không soát lại chương này (không phải lịch sử / chưa có kịch bản / đã duyệt); soát được thì null. */
function recheckSkipReason(history: boolean, chapter: { content: string; status: string }): string | null {
  if (!history) return "không phải kênh lịch sử";
  if (!chapter.content.trim()) return "chưa có kịch bản";
  if (chapter.status === "approved") return "đã duyệt — bỏ duyệt trước";
  return null;
}

const SECONDS_PER_MINUTE = 60;

/** Lưu lại metadata ảnh/nhạc đã dùng (không kèm file — chỉ còn trên máy chạy job dựng) để job hoàn tất sau đọc lại. */
async function persistHistoryCredits(videoId: number, made: HistoryCredits) {
  const stored = {
    images: made.images.map(({ title, url, license, artist, synthetic }) => ({ title, url, license, artist, synthetic })),
    musicFiles: made.musicFiles,
  };
  await db()
    .update(videos)
    .set({ meta: sql`coalesce(${videos.meta}, '{}'::jsonb) || jsonb_build_object('historyCredits', ${JSON.stringify(stored)}::jsonb)` })
    .where(eq(videos.id, videoId));
}

/** Dựng video cho một chương lịch sử đã duyệt (CLI: render.ts "historyvideo:<videoId>"). */
export async function buildHistoryVideo(videoId: number) {
  const { renderHistoryVideo, HistoryQcError } = await import("./history-render");
  try {
    const made = await renderHistoryVideo(videoId);
    console.log(`✔ Video #${videoId}: ${made.file} (${made.seconds.toFixed(0)} giây)`);
    if (made.credits) console.log(made.credits);
    await persistHistoryCredits(videoId, made);
    await notify(`🎞 <b>Video lịch sử #${videoId} đã dựng xong</b> — ${Math.round(made.seconds / SECONDS_PER_MINUTE)} phút
👉 ${WEB_URL}/videos/${videoId}`);
    return made;
  } catch (e) {
    if (!(e instanceof HistoryQcError)) throw e;
    console.log(`⚠ Video #${videoId} chưa đạt kiểm tra, KHÔNG đăng:`);
    for (const problem of e.problems) console.log(`  • ${problem}`);
    await notify(`⚠️ Video #${videoId} (kênh lịch sử) chưa đạt kiểm tra:\n${e.problems.slice(0, 5).join("\n")}`);
    return null;
  }
}

/** Soát lại + chốt một kịch bản lịch sử đã viết (vd sau khi sửa tay); còn lỗi → null (đã báo Telegram). */
export async function recheckHistoryScript(chapterId: number): Promise<{ chapterId: number; words: number } | null> {
  await loadSecrets(true);
  const chapter = await getChapter(chapterId);
  const s = await getSeries(chapter.seriesId);
  const skip = recheckSkipReason(isHistoryStory(s), chapter);
  if (skip) {
    console.log(`• Bỏ qua soát lại chương #${chapterId}: ${skip}`);
    return null;
  }
  try {
    const done = await writeChapterStep(chapterId, "finish");
    console.log(`✔ Soát lại đạt — ${done.words} từ, đã chốt kịch bản`);
    return { chapterId, words: done.words };
  } catch (e) {
    if (!(e instanceof FactCheckFailedError)) throw e;
    console.log(`⚠ ${e.message}`);
    return null;
  }
}

/** Viết trọn kịch bản cho đề tài kế tiếp; lỗi sự thật còn sau soát → null (đã báo Telegram, đề tài "chờ sửa"). */
export async function writeHistoryScript(seriesId: number): Promise<{ chapterId: number; words: number } | null> {
  await loadSecrets(true);
  const s = await getSeries(seriesId);
  const topics = await db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
  const next = pickChapterToWrite(topics);
  if (!next) {
    console.log(`• ${s.title}: không còn đề tài nào để viết`);
    return null;
  }
  console.log(`▶ ${s.title} — đề tài ${next.number}: ${next.title}`);
  try {
    let step = await writeChapterStep(next.id, next.content ? "continue" : "start");
    console.log(`  lượt đầu: ${step.words} từ`);
    for (let i = 0; i < maxContinues(s.targetWords) && !step.enough; i++) {
      step = await writeChapterStep(next.id, "continue");
      console.log(`  viết tiếp: ${step.words} từ`);
    }
    const done = await writeChapterStep(next.id, "finish");
    console.log(`✔ Kịch bản ${done.words} từ — soát sự thật đạt`);
    return { chapterId: next.id, words: done.words };
  } catch (e) {
    if (!(e instanceof FactCheckFailedError)) throw e;
    console.log(`⚠ ${e.message}:`);
    for (const issue of e.issues) console.log(`  • “${issue.quote}” → ${issue.note}`);
    return null;
  }
}

/** Video lịch sử của bộ xét tới (trường tối thiểu dùng để chọn việc — lấy đủ hơn ở `historyAuto`). */
export type HistoryQueueRow = {
  id: number; status: string; youtubeVideoId: string | null; publishAt: Date | null; meta: VideoMeta | null;
  uploadStatus: "none" | "uploading" | "scheduled" | "failed";
};

/**
 * Video đã dựng xong, QC đạt (status `ready`), chưa có trên YouTube — cũ nhất trước, không có → undefined.
 * Ưu tiên cao nhất: hoàn tất (meta/thumbnail/đăng) một video đã xong trước khi dựng thêm video mới. Bỏ qua
 * video `uploadStatus` `failed` (lượt trước đăng lỗi hoặc thiếu ghi công, đã báo Telegram — chờ chủ kênh xử lý
 * tay) hoặc `scheduled` (đã đăng xong, chỉ chưa kịp đồng bộ `youtubeVideoId`).
 */
export function pickHistoryVideoToFinish(rows: Pick<HistoryQueueRow, "id" | "status" | "youtubeVideoId" | "uploadStatus">[]): HistoryQueueRow["id"] | undefined {
  return rows
    .filter((v) => v.status === "ready" && !v.youtubeVideoId && v.uploadStatus !== "failed" && v.uploadStatus !== "scheduled")
    .sort((a, b) => a.id - b.id)[0]?.id;
}

/**
 * Video đang xếp hàng (status `queued`), cũ nhất trước — không có → undefined. CHỈ dựng lại `queued`: `failed` là
 * video đã TRƯỢT QC (keepVideo đặt status này — xem history-render.ts) cần sửa tay rồi "Soát lại"; dựng lại tự
 * động sẽ lặp đúng lỗi QC vô hạn, tốn 1,5–4,5 giờ máy mỗi ngày mà không bao giờ sang đề tài mới. Lỗi hạ tầng thật
 * (mạng, hết quota giữa chừng) không làm video rơi về `failed` — nó kẹt ở `rendering`, và `requeueStuck`
 * (daily.ts, chờ 7 giờ cho video lịch sử) mới trả nó về `queued`.
 */
export function pickHistoryVideoToRebuild(rows: Pick<HistoryQueueRow, "id" | "status" | "youtubeVideoId">[]): HistoryQueueRow["id"] | undefined {
  return rows.filter((v) => v.status === "queued" && !v.youtubeVideoId).sort((a, b) => a.id - b.id)[0]?.id;
}

/**
 * Kho video của bộ đang "có trong hệ thống, chưa phát xong" (đếm như `writeSeries` đếm kho chuyện đời/tiên hiệp):
 * mọi trạng thái trừ `failed`, chưa tới giờ phát (hoặc chưa có lịch), không phải bản gộp. KHÔNG dùng status
 * `ready` đơn thuần — `ready` chỉ tồn tại vài giây tới lúc đăng xong rồi chuyển `published`, đếm theo `ready`
 * luôn ra 0 và daily dispatch dư job lịch sử mỗi ngày.
 */
export function countHistoryBacklog(rows: Pick<HistoryQueueRow, "status" | "publishAt" | "meta">[], now = new Date()): number {
  return rows.filter((v) => v.status !== "failed" && !v.meta?.compilation && (!v.publishAt || v.publishAt > now)).length;
}

/** Kho video lịch sử (mọi trạng thái chưa phát xong) trước khi ngưng viết/dựng thêm — mỗi lượt dựng tới 4,5 giờ, không cần tích nhiều. */
export const HISTORY_BUFFER = 2;

/** Giữ chỗ nguyên tử cho `historyauto` — hai job cùng gọi lệnh này (vd daily dispatch trễ) không bao giờ dựng trùng một video. */
async function claimHistoryVideo(videoId: number): Promise<boolean> {
  const claimed = await db()
    .update(videos)
    .set({ status: "rendering", error: null, updatedAt: new Date() })
    .where(and(eq(videos.id, videoId), eq(videos.status, "queued")))
    .returning({ id: videos.id });
  return claimed.length > 0;
}

/** Hết video chờ dựng lại: viết đề tài kế tiếp, duyệt rồi xếp hàng (status `queued` mặc định); không còn đề tài → null. */
async function startNextHistoryVideo(seriesId: number): Promise<number | null> {
  const written = await writeHistoryScript(seriesId);
  if (!written) return null;
  await db().update(chapters).set({ status: "approved", updatedAt: new Date() }).where(eq(chapters.id, written.chapterId));
  const [row] = await db().insert(videos).values({ chapterId: written.chapterId }).returning({ id: videos.id });
  return row.id;
}

/** Ảnh tư liệu không có sẵn (và không tải lại được từ Commons) thì AI vẽ tạm cho thumbnail. */
const thumbnailFallbackPrompt = (chapterTitle: string) =>
  `Historical documentary illustration, ${chapterTitle}, old woodblock print / engraving style, aged paper, muted sepia, period-correct, no text`;

/** Đưa metadata ảnh đã lưu (không có file — xem `persistHistoryCredits`) về `ArtImage[]` cho `historyVideoMeta`/`pickThumbnailImage` dùng chung. */
function creditsFromStoredMeta(stored: NonNullable<VideoMeta["historyCredits"]>): HistoryCredits {
  return { images: stored.images.map((image) => ({ ...image, file: "" })), musicFiles: stored.musicFiles };
}

/**
 * Có đủ dữ liệu ghi công để đăng không — video lịch sử nào dựng đạt QC cũng luôn có nhạc (musicPlan không bao
 * giờ rỗng khi còn cảnh, và QC đòi `shots.length` > 0). Rỗng nghĩa là mất dữ liệu ghi công (resume thiếu
 * `videos.meta.historyCredits`, hoặc video dựng tay bằng `historyvideo:` từ trước khi có trường này) — KHÔNG
 * được đăng vì sẽ thiếu ghi công bắt buộc của giấy phép CC BY (nhạc) / CC BY-SA (ảnh).
 */
export function hasRequiredCredits(credits: HistoryCredits): boolean {
  return credits.musicFiles.length > 0;
}

const COMMONS_THUMB_WIDTH = 1920;

type CommonsImageInfoResponse = { query?: { pages?: Record<string, { imageinfo?: { thumburl?: string }[] }> } };

/** Đường dẫn ảnh gốc trên Commons theo đúng tên file đã ghi công — không có → null (API lỗi, ảnh bị xoá…). */
async function resolveCommonsImageUrl(title: string): Promise<string | null> {
  const params = new URLSearchParams({ action: "query", format: "json", titles: title, prop: "imageinfo", iiprop: "url", iiurlwidth: String(COMMONS_THUMB_WIDTH) });
  const data = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": WIKI_USER_AGENT } })
    .then((res) => (res.ok ? (res.json() as Promise<CommonsImageInfoResponse>) : null))
    .catch(() => null);
  const page = Object.values(data?.query?.pages ?? {})[0];
  return page?.imageinfo?.[0]?.thumburl ?? null;
}

/** Tải lại ảnh tư liệu Commons về `dir` theo tên file đã ghi công (job hoàn tất không phải job đã dựng, không còn file cục bộ); lỗi → null (lùi về AI vẽ). */
async function downloadCommonsThumbnailSource(image: ArtImage, dir: string): Promise<string | null> {
  const direct = await resolveCommonsImageUrl(image.title);
  if (!direct) return null;
  const imageBytes = await fetch(direct, { headers: { "User-Agent": WIKI_USER_AGENT } })
    .then((res) => (res.ok ? res.arrayBuffer() : null))
    .catch(() => null);
  if (!imageBytes) return null;
  const file = path.join(dir, "thumb-src.jpg");
  await writeFile(file, Buffer.from(imageBytes));
  return file;
}

/**
 * Ảnh dùng cho thumbnail: file cục bộ có sẵn (vừa dựng trong lượt này) thì dùng ngay; đã resume từ DB (không
 * còn file) thì tải lại từ Commons theo tên file đã ghi công — chủ kênh ghét ảnh AI (FLUX), chỉ lùi về AI vẽ khi
 * không còn ảnh tư liệu thật nào dùng được.
 */
async function resolveThumbnailSource(images: ArtImage[], dir: string): Promise<string | null> {
  const picked = pickThumbnailImage(images);
  if (!picked || picked.synthetic) return null;
  if (picked.file && (await stat(picked.file).then(() => true, () => false))) return picked.file;
  return downloadCommonsThumbnailSource(picked, dir);
}

/**
 * File `long.mp4` của video đã dựng — có sẵn cục bộ (vừa dựng trong lượt này) thì dùng luôn; không thì tải lại từ
 * release (job hoàn tất chạy trên runner khác runner đã dựng — đĩa không giữ qua lượt dispatch).
 */
async function ensureLocalLongVideo(videoId: number, dir: string): Promise<string> {
  const file = path.join(dir, "long.mp4");
  if (await stat(file).then(() => true, () => false)) return file;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error(`Video #${videoId}: không còn file dựng cục bộ và thiếu GITHUB_REPOSITORY để tải lại từ release.`);
  await mkdir(dir, { recursive: true });
  await run("gh", ["release", "download", `video-${videoId}`, "--repo", repo, "-p", "long.mp4", "-D", dir, "--clobber"]);
  return file;
}

/** Meta để đăng + dòng ghi công ảnh không vừa mô tả (đăng bình luận riêng — xem `postOverflowCredits`). */
type HistoryFinishMeta = { meta: VideoMeta; overflowCredits: string[] };

/** Đầu vào của `resolveHistoryMeta`: video + bộ truyện + ghi công đã dựng + meta hiện có (null = chưa có). */
type ResolveHistoryMetaInput = { series: Series; chapter: Chapter; credits: HistoryCredits; existing: VideoMeta | null };

/**
 * Tiêu đề/mô tả/thumbnail: chủ kênh đã có (sửa tay hoặc lượt trước đã sinh) thì GIỮ NGUYÊN, không gọi AI viết
 * lại tốn quota lẫn mất bản chủ kênh sửa; chưa có thì sinh mới.
 */
async function resolveHistoryMeta(video: ResolveHistoryMetaInput): Promise<HistoryFinishMeta> {
  if (video.existing?.title) return { meta: video.existing, overflowCredits: [] };
  return historyVideoMeta({ series: video.series, chapter: video.chapter, images: video.credits.images, musicFiles: video.credits.musicFiles });
}

/** Chia các dòng ghi công thành nhiều đoạn, mỗi đoạn không vượt `maxBytes` — một bình luận YouTube tối đa `COMMENT_MAX` ký tự. */
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

/** Đầu vào của `postOverflowCredits`: video + id YouTube vừa đăng + kênh (để lấy đúng tài khoản) + dòng ghi công còn thiếu. */
type PostOverflowCreditsInput = { videoId: number; youtubeId: string; channel: string; lines: string[] };

/**
 * Ghi công ảnh không vừa mô tả (vượt ngân sách byte) đăng thành bình luận của video — KHÔNG bỏ bớt ghi công,
 * giấy phép CC BY-SA bắt buộc ghi công đủ từng ảnh. Chia nhiều bình luận nếu dài; đăng lỗi hay chưa kết nối
 * YouTube thì báo Telegram kèm nguyên nội dung để chủ kênh dán tay.
 */
async function postOverflowCredits(o: PostOverflowCreditsInput) {
  const { videoId, youtubeId, channel, lines } = o;
  if (!lines.length) return;
  const auth = await getYoutubeAuth(channel).catch(() => null);
  if (!auth) {
    await notify(`⚠️ Video lịch sử #${videoId}: còn ${lines.length} ảnh chưa ghi công trong mô tả (hết chỗ), chưa kết nối YouTube để đăng bình luận — ghi công tay giúp:\n${escapeHtml(lines.join("\n")).slice(0, 1500)}`);
    return;
  }
  const token = await accessToken(auth.refreshToken);
  const chunks = chunkCreditLines(lines, COMMENT_MAX - Buffer.byteLength(OVERFLOW_CREDIT_HEADER, "utf8") - OVERFLOW_CREDIT_HEADER_MARGIN);
  for (const [i, chunk] of chunks.entries()) {
    const text = `${OVERFLOW_CREDIT_HEADER}${chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ""}\n${chunk.join("\n")}`;
    const err = await postComment(token, youtubeId, text);
    if (err) await notify(`⚠️ Video lịch sử #${videoId}: đăng bình luận ghi công ảnh lỗi (${escapeHtml(err)}) — ghi công tay giúp:\n${escapeHtml(chunk.join("\n")).slice(0, 1500)}`);
  }
}

/** Đầu vào của `finishHistoryVideo`: video đã dựng xong (QC đạt) + bộ truyện của nó (để biết kênh, lấy lịch đăng). */
type FinishHistoryVideoInput = { videoId: number; series: Series; credits: HistoryCredits };

/**
 * Tạo tiêu đề/mô tả/thumbnail rồi đăng YouTube cho một video lịch sử đã dựng xong, QC đạt (status `ready`).
 * Gọi ngay sau khi `buildHistoryVideo` vừa dựng xong (còn `images`/`musicFiles` trong tay), hoặc để hoàn tất
 * một video đã dựng từ lượt trước mà chưa đăng được (đọc lại `videos.meta.historyCredits`). Thiếu ghi công
 * (nhạc/ảnh) thì KHÔNG đăng — đánh dấu `uploadStatus: failed` để lượt sau không chọn lại, báo Telegram.
 */
async function finishHistoryVideo(o: FinishHistoryVideoInput) {
  const { videoId, series: s, credits } = o;
  if (!hasRequiredCredits(credits)) {
    const reason = "Thiếu dữ liệu ghi công nhạc/ảnh (historyCredits) — không đăng để tránh vi phạm giấy phép CC BY/CC BY-SA.";
    await db().update(videos).set({ uploadStatus: "failed", uploadError: reason, updatedAt: new Date() }).where(eq(videos.id, videoId));
    await notify(`⚠️ Video lịch sử #${videoId} dựng xong nhưng thiếu dữ liệu ghi công nhạc/ảnh — KHÔNG đăng, cần xem/ghi công tay.\n👉 ${WEB_URL}/videos/${videoId}`);
    return;
  }
  const [v] = await db().select({ chapterId: videos.chapterId, publishAt: videos.publishAt, meta: videos.meta }).from(videos).where(eq(videos.id, videoId));
  const chapter = await getChapter(v.chapterId);
  const dir = path.resolve(".render", `history-${videoId}`);
  await mkdir(dir, { recursive: true });
  const { meta, overflowCredits } = await resolveHistoryMeta({ series: s, chapter, credits, existing: v.meta });
  // Gộp vào meta hiện có (không ghi đè cả cột) — chủ kênh sửa tay, hoặc chính `historyCredits` vừa lưu, không được mất.
  const finalMeta: VideoMeta = { ...(v.meta ?? {}), ...meta };
  const src = await resolveThumbnailSource(credits.images, dir);
  const thumb = await thumbnail(dir, thumbnailFallbackPrompt(chapter.title), finalMeta.thumbnailText ?? "", src ? { src } : {});
  const releaseId = await ensureRelease(videoId, false);
  await uploadAsset(videoId, releaseId, thumb);
  const file = await ensureLocalLongVideo(videoId, dir);

  const publishAt = await keepOrNextSlot(v.publishAt, s.channel);
  const publish = await autoPublishEligible(videoId);
  await db()
    .update(videos)
    .set({ meta: finalMeta, publishAt, updatedAt: new Date(), ...(publish ? { uploadStatus: "uploading" as const, uploadError: null } : {}) })
    .where(eq(videos.id, videoId));
  if (!publish) return;
  await publishToYoutube(videoId, { long: file, thumb });
  const [after] = await db().select({ youtubeVideoId: videos.youtubeVideoId }).from(videos).where(eq(videos.id, videoId));
  if (!after?.youtubeVideoId) {
    // publishToYoutube tự báo Telegram khi đăng lỗi và đặt uploadStatus "failed" — lượt sau không chọn lại video này.
    console.warn(`⚠ Video #${videoId}: đăng YouTube không thành công, xem thông báo lỗi riêng.`);
    return;
  }
  await postOverflowCredits({ videoId, youtubeId: after.youtubeVideoId, channel: s.channel, lines: overflowCredits });
}

/** Một lượt `historyAuto`: đúng MỘT nhánh ưu tiên (a/b/c/d) rồi thoát — không gộp nhiều việc nặng vào một job. */
async function historyAutoStep(seriesId: number, s: Series): Promise<void> {
  const rows = await db()
    .select({
      id: videos.id, status: videos.status, youtubeVideoId: videos.youtubeVideoId, publishAt: videos.publishAt, meta: videos.meta,
      uploadStatus: videos.uploadStatus,
    })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(eq(chapters.seriesId, seriesId))
    .orderBy(asc(videos.id));

  // Kiểm đăng được không TRƯỚC khi làm bất cứ việc gì (tải long.mp4, gọi AI viết meta, vẽ thumbnail) — chưa
  // kết nối YouTube / autoPublish tắt thì làm trước cũng vô nghĩa, để chủ kênh xử lý tay từ Studio.
  const toFinish = pickHistoryVideoToFinish(rows);
  if (toFinish && (await autoPublishEligible(toFinish))) {
    const stored = rows.find((v) => v.id === toFinish)!.meta?.historyCredits;
    console.log(`▶ ${s.title}: video #${toFinish} đã dựng xong, chưa đăng — hoàn tất (meta/thumbnail/đăng)`);
    await finishHistoryVideo({ videoId: toFinish, series: s, credits: stored ? creditsFromStoredMeta(stored) : { images: [], musicFiles: [] } });
    return;
  }

  const toRebuild = pickHistoryVideoToRebuild(rows);
  if (toRebuild) {
    if (!(await claimHistoryVideo(toRebuild))) {
      console.log(`⏭ Video #${toRebuild} đang được job khác xử lý — bỏ qua.`);
      return;
    }
    const made = await buildHistoryVideo(toRebuild);
    if (made) await finishHistoryVideo({ videoId: toRebuild, series: s, credits: { images: made.images, musicFiles: made.musicFiles } });
    return;
  }

  const backlog = countHistoryBacklog(rows);
  if (backlog >= HISTORY_BUFFER) {
    console.log(`• ${s.title}: kho đủ ${backlog}/${HISTORY_BUFFER} — chưa cần viết/dựng thêm`);
    return;
  }

  const videoId = await startNextHistoryVideo(seriesId);
  if (!videoId) {
    console.log(`• ${s.title}: không còn đề tài nào để viết`);
    return;
  }
  console.log(`✔ ${s.title}: đã viết + duyệt video #${videoId} — để lượt daily kế tiếp dựng`);
}

/**
 * Trọn vòng tự chạy một bộ lịch sử (CLI: render.ts "historyauto:<seriesId>"). Mọi lỗi ở bước hoàn tất (meta/
 * thumbnail/release/đăng) đều báo Telegram, không nuốt im — hết quota AI free thì chỉ báo rồi thoát mã 0 (lượt
 * daily kế tiếp làm tiếp), lỗi khác báo rồi ném lại để job Actions hiện đỏ.
 */
export async function historyAuto(seriesId: number): Promise<void> {
  await loadSecrets(true);
  const s = await getSeries(seriesId);
  try {
    await historyAutoStep(seriesId, s);
  } catch (e) {
    if (e instanceof QuotaExhaustedError) {
      console.log(`⏸ ${s.title}: ${e.message}`);
      await notify(`⏸ Kênh lịch sử <b>${escapeHtml(s.title)}</b> hết lượt AI free hôm nay — tự chạy tiếp lượt sau.\n${escapeHtml(e.message.slice(0, 200))}`);
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error(e);
    await notify(`❌ <b>Kênh lịch sử ${escapeHtml(s.title)} lỗi</b> (historyauto:${seriesId}):\n${escapeHtml(msg.slice(0, 500))}`);
    throw e;
  }
}
