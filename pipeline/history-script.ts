// Viết một kịch bản lịch sử (CLI: render.ts "historyscript:<seriesId>"): đề tài kế tiếp → gom hồ sơ → viết nhiều lượt → soát sự thật.
// historyAuto (CLI: "historyauto:<seriesId>") là trọn vòng tự chạy: dựng lại video cũ lỗi hạ tầng còn chưa lên YouTube,
// hết thì viết đề tài mới rồi dựng; dựng đạt QC thì tạo meta + thumbnail + đăng YouTube (daily.ts dispatch lệnh này).
import path from "node:path";
import { and, asc, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { chapters, videos, type Series } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { notify, WEB_URL } from "@/lib/notify";
import { FactCheckFailedError } from "@/lib/story/fact-check";
import { isHistoryStory, pickChapterToWrite } from "@/lib/story/history";
import { maxContinues } from "@/lib/story/prompts";
import { getChapter, getSeries, writeChapterStep } from "@/lib/story/service";
import { historyVideoMeta, pickThumbnailImage } from "./history-meta";
import { ensureRelease, uploadAsset } from "./release";
import { thumbnail } from "./render";
import { keepOrNextSlot } from "./schedule";
import type { ArtImage } from "./scene-art";
import { autoPublishEligible, publishToYoutube } from "./youtube";

/** Lý do không soát lại chương này (không phải lịch sử / chưa có kịch bản / đã duyệt); soát được thì null. */
function recheckSkipReason(history: boolean, chapter: { content: string; status: string }): string | null {
  if (!history) return "không phải kênh lịch sử";
  if (!chapter.content.trim()) return "chưa có kịch bản";
  if (chapter.status === "approved") return "đã duyệt — bỏ duyệt trước";
  return null;
}

const SECONDS_PER_MINUTE = 60;

/** Dựng video cho một chương lịch sử đã duyệt (CLI: render.ts "historyvideo:<videoId>"). */
export async function buildHistoryVideo(videoId: number) {
  const { renderHistoryVideo, HistoryQcError } = await import("./history-render");
  try {
    const made = await renderHistoryVideo(videoId);
    console.log(`✔ Video #${videoId}: ${made.file} (${made.seconds.toFixed(0)} giây)`);
    if (made.credits) console.log(made.credits);
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

/** Video lịch sử của bộ xét tới. */
export type HistoryRebuildCandidate = { id: number; status: string; youtubeVideoId: string | null };

/**
 * Video chưa lên YouTube còn kẹt vì lỗi hạ tầng (queued/failed, KHÔNG phải QC — video trượt QC vẫn ở `failed`
 * nhưng đã báo Telegram ở buildHistoryVideo và cần sửa tay nên vẫn hợp lệ để dựng lại), cũ nhất trước — không có → undefined.
 */
export function pickHistoryVideoToRebuild(candidates: HistoryRebuildCandidate[]): HistoryRebuildCandidate | undefined {
  return candidates
    .filter((v) => !v.youtubeVideoId && (v.status === "queued" || v.status === "failed"))
    .sort((a, b) => a.id - b.id)[0];
}

/** Giữ chỗ nguyên tử cho `historyauto` — hai job cùng gọi lệnh này (vd daily dispatch trễ) không bao giờ dựng trùng một video. */
async function claimHistoryVideo(videoId: number): Promise<boolean> {
  const claimed = await db()
    .update(videos)
    .set({ status: "rendering", error: null, updatedAt: new Date() })
    .where(and(eq(videos.id, videoId), or(eq(videos.status, "queued"), eq(videos.status, "failed"))))
    .returning({ id: videos.id });
  return claimed.length > 0;
}

/** Hết video chờ dựng lại: viết đề tài kế tiếp, duyệt rồi tạo video mới; không còn đề tài → null. */
async function startNextHistoryVideo(seriesId: number): Promise<number | null> {
  const written = await writeHistoryScript(seriesId);
  if (!written) return null;
  await db().update(chapters).set({ status: "approved", updatedAt: new Date() }).where(eq(chapters.id, written.chapterId));
  const [row] = await db().insert(videos).values({ chapterId: written.chapterId }).returning({ id: videos.id });
  return row.id;
}

/** Ảnh tư liệu không có sẵn thì AI vẽ tạm cho thumbnail (chỉ xảy ra khi video toàn cảnh bản đồ/thẻ chữ, gần như không có). */
const thumbnailFallbackPrompt = (chapterTitle: string) =>
  `Historical documentary illustration, ${chapterTitle}, old woodblock print / engraving style, aged paper, muted sepia, period-correct, no text`;

/** Video lịch sử vừa dựng đạt QC (kết quả của `renderHistoryVideo`, qua `buildHistoryVideo`). */
type RenderedHistoryVideo = { file: string; images: ArtImage[]; musicFiles: string[] };

/** Đầu vào của `finishHistoryVideo`: video vừa dựng đạt QC + bộ truyện của nó (để biết kênh, lấy lịch đăng). */
type FinishHistoryVideoInput = { videoId: number; series: Series; made: RenderedHistoryVideo };

/**
 * Tạo tiêu đề/mô tả/thumbnail rồi đăng YouTube cho video lịch sử vừa dựng đạt QC. Chỉ gọi sau khi `buildHistoryVideo`
 * trả về khác null (QC đạt) — video trượt QC đã được báo Telegram và không đi tới bước này.
 */
async function finishHistoryVideo(o: FinishHistoryVideoInput) {
  const { videoId, series: s, made } = o;
  const [v] = await db().select({ chapterId: videos.chapterId, publishAt: videos.publishAt }).from(videos).where(eq(videos.id, videoId));
  const chapter = await getChapter(v.chapterId);
  const dir = path.resolve(".render", `history-${videoId}`);
  const meta = await historyVideoMeta({ series: s, chapter, images: made.images, musicFiles: made.musicFiles });
  const src = pickThumbnailImage(made.images);
  const thumb = await thumbnail(dir, thumbnailFallbackPrompt(chapter.title), meta.thumbnailText ?? "", src ? { src } : {});
  const releaseId = await ensureRelease(videoId, false);
  await uploadAsset(videoId, releaseId, thumb);

  const publishAt = await keepOrNextSlot(v.publishAt, s.channel);
  const publish = await autoPublishEligible(videoId);
  await db()
    .update(videos)
    .set({ meta, publishAt, updatedAt: new Date(), ...(publish ? { uploadStatus: "uploading" as const, uploadError: null } : {}) })
    .where(eq(videos.id, videoId));
  if (publish) await publishToYoutube(videoId, { long: made.file, thumb });
}

/**
 * Trọn vòng tự chạy một bộ lịch sử (CLI: render.ts "historyauto:<seriesId>", daily.ts dispatch job riêng vì dựng
 * tới 4,5 giờ): có video chưa lên YouTube kẹt lỗi hạ tầng → dựng lại; không có → viết đề tài mới rồi dựng.
 * Dựng đạt QC thì tạo meta + thumbnail + đăng YouTube ngay; trượt QC thì dừng (đã báo Telegram ở buildHistoryVideo).
 */
export async function historyAuto(seriesId: number): Promise<void> {
  await loadSecrets(true);
  const s = await getSeries(seriesId);
  const candidates = await db()
    .select({ id: videos.id, status: videos.status, youtubeVideoId: videos.youtubeVideoId })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(eq(chapters.seriesId, seriesId));
  const rebuild = pickHistoryVideoToRebuild(candidates);
  const videoId = rebuild ? rebuild.id : await startNextHistoryVideo(seriesId);
  if (!videoId) {
    console.log(`• ${s.title}: không có video chờ dựng lại, không còn đề tài để viết`);
    return;
  }
  if (!(await claimHistoryVideo(videoId))) {
    console.log(`⏭ Video #${videoId} đang được job khác xử lý — bỏ qua.`);
    return;
  }
  const made = await buildHistoryVideo(videoId);
  if (!made) return;
  await finishHistoryVideo({ videoId, series: s, made });
}
