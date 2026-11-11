import { addToSeriesPlaylist, playlistUrl } from "./playlist";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { accessToken, cleanTags, getYoutubeAuth, noAngle, YoutubeAuthError } from "@/lib/youtube";
import { recordYoutubeUnits } from "@/lib/yt-units";
import { Tracker } from "./progress";
import { keepOrNextSlot } from "./schedule";
import { DEFAULT_THUMB, pickBestThumb, type ThumbId, type ThumbScores } from "./thumb-plan";
import { scoreThumbnail } from "./vidiq";

/** publishAt = null: đăng công khai ngay. */
export type Upload = { file: string; title: string; description: string; tags: string[]; publishAt: Date | null };

/** Upload resumable: xin URL phiên rồi PUT cả file (stream, không nạp vào RAM). Trả id video YouTube. */
export async function uploadVideo(token: string, u: Upload) {
  const size = (await stat(u.file)).size;
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      // 24 = Entertainment.
      snippet: { title: u.title.slice(0, 100), description: u.description.slice(0, 5000), tags: u.tags, categoryId: "24", defaultLanguage: "vi" },
      status: {
        // Lên lịch: để riêng tư tới đúng giờ thì YouTube tự công khai; không có lịch thì công khai ngay.
        ...(u.publishAt ? { privacyStatus: "private", publishAt: u.publishAt.toISOString() } : { privacyStatus: "public" }),
        selfDeclaredMadeForKids: false,
        // Nhãn "nội dung đã chỉnh sửa/tổng hợp" bắt buộc với giọng đọc + ảnh AI.
        containsSyntheticMedia: true,
      },
    }),
  });
  if (init.ok) await recordYoutubeUnits("videoUpload");
  const location = init.headers.get("location");
  if (!init.ok || !location) throw new Error(`YouTube từ chối upload: ${init.status} ${(await init.text()).slice(0, 300)}`);
  const res = await fetch(location, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: Readable.toWeb(createReadStream(u.file)) as ReadableStream,
    duplex: "half",
  } as RequestInit);
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !body.id) throw new Error(`Upload YouTube lỗi: ${res.status} ${body.error?.message ?? ""}`);
  return body.id;
}

export async function setThumbnail(token: string, videoId: string, file: string) {
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
    body: new Uint8Array(await readFile(file)),
  });
  await recordYoutubeUnits("thumbnailSet");
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

/**
 * Chấm từng phương án thumbnail bằng vidIQ rồi chọn điểm cao nhất. vidIQ chỉ chấm được ảnh đang đặt trên YouTube
 * (không nhận URL ngoài) → đặt lần lượt từng ảnh lên video, đợi YouTube cập nhật, cho vidIQ chấm; cuối cùng người gọi đặt ảnh thắng.
 * Không chấm được / lỗi → phương án (a). Không bao giờ ném lỗi. Tốn thêm 50 unit YouTube / phương án.
 */
export async function chooseThumbnail(_videoId: number, ytId: string, title: string, thumbs: { id: ThumbId; file: string }[], track: Tracker) {
  const scores: ThumbScores = {};
  const auth = await getYoutubeAuth().catch(() => null);
  const token = auth ? await accessToken(auth.refreshToken).catch(() => null) : null;
  if (token && thumbs.length > 1) {
    for (const t of thumbs) {
      try {
        await setThumbnail(token, ytId, t.file);
        await new Promise((r) => setTimeout(r, THUMB_SETTLE_MS));
        scores[t.id] = await scoreThumbnail({ videoId: ytId, title });
      } catch (e) {
        scores[t.id] = null;
        track.warn("youtube", `Không chấm được thumbnail ${t.id.toUpperCase()}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  const chosen = pickBestThumb(scores, thumbs.map((t) => t.id));
  track.log("youtube", `Điểm thumbnail vidIQ: ${thumbs.map((t) => `${t.id.toUpperCase()}=${scores[t.id] ?? "?"}`).join(", ")} → dùng ${chosen.toUpperCase()}`);
  console.log(`  Điểm thumbnail vidIQ: ${JSON.stringify(scores)} → ${chosen.toUpperCase()}`);
  const file = (thumbs.find((t) => t.id === chosen) ?? thumbs.find((t) => t.id === DEFAULT_THUMB) ?? thumbs[0]).file;
  return { file, scores: { a: scores.a ?? null, b: scores.b ?? null, c: scores.c ?? null, chosen } };
}

/** Đợi sau khi đặt thumbnail để YouTube kịp cập nhật ảnh trước khi vidIQ đọc. */
const THUMB_SETTLE_MS = 25_000;

const slot = (d: Date) =>
  d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Video này có nên tự đăng không: bật tự đăng, đã kết nối YouTube, chưa có trên YouTube, đang chạy trên GitHub Actions.
 * Render hỏi trước để ghi `ready` + `uploading` cùng lúc (màn flow không ngắt cập nhật trực tiếp giữa chừng).
 */
export async function autoPublishEligible(videoId: number) {
  if (!process.env.GITHUB_ACTIONS) return false;
  const [row] = await db()
    .select({ ytId: videos.youtubeVideoId, autoPublish: series.autoPublish, episodeChapters: series.episodeChapters, meta: videos.meta })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(videos.id, videoId));
  // Chế độ tập: video chương chỉ là nguyên liệu, chỉ tập (meta.compilation.episode) mới đăng.
  if (row && row.episodeChapters > 0 && !row.meta?.compilation?.episode) return false;
  return Boolean(row?.autoPublish && !row.ytId && (await getYoutubeAuth()));
}

export { cleanTags };

/**
 * Đăng video đã render lên YouTube theo lịch. Người gọi đã "giữ chỗ" (`uploadStatus = uploading`):
 * render sau khi `autoPublishEligible`, hoặc nút "Đăng lại". Mọi lỗi → `failed` + báo Telegram, video vẫn `ready` để đăng tay.
 */
export async function publishToYoutube(videoId: number, files: { long: string; short?: string; thumb?: string; thumbs?: { id: ThumbId; file: string }[] }) {
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v) return;
  const track = new Tracker(videoId, v.progress);
  track.start("youtube", { long: 1, ...(files.short ? { short: 1 } : {}) });
  try {
    if (!v.meta) throw new Error("Video chưa có tiêu đề/mô tả.");
    // Chống đăng trùng: đã có id YouTube thì không upload lại.
    if (v.youtubeVideoId) throw new Error(`Video đã có trên YouTube (youtu.be/${v.youtubeVideoId}) — không đăng lại.`);
    const auth = await getYoutubeAuth();
    if (!auth) throw new YoutubeAuthError("Chưa kết nối YouTube — bấm “Kết nối YouTube” trên node Đăng YouTube.");
    const token = await accessToken(auth.refreshToken);
    const publishAt = await keepOrNextSlot(v.publishAt);
    const meta = v.meta;

    track.log("youtube", "Upload video dài");
    const tags = cleanTags(meta.tags);
    const id = await uploadVideo(token, { file: files.long, title: noAngle(meta.title), description: noAngle(meta.description), tags, publishAt });
    // Lưu id ngay: lỗi ở bước sau cũng không upload trùng lần nữa.
    await db().update(videos).set({ youtubeVideoId: id, youtubeUrl: `https://youtu.be/${id}`, publishAt }).where(eq(videos.id, videoId));
    track.tick("youtube", "long", `Video dài: youtu.be/${id}`);

    // Video chương tự vào danh sách phát của bộ truyện (bản gộp 5 chương cũ thì không — tránh lặp nội dung; tập ngày thì có).
    if (!meta.compilation || meta.compilation.episode) {
      const [ch] = await db().select({ seriesId: chapters.seriesId }).from(chapters).where(eq(chapters.id, v.chapterId));
      await addToSeriesPlaylist(ch.seriesId, id).then(
        (pl) => track.log("youtube", `Đã thêm vào danh sách phát ${playlistUrl(pl)}`),
        (e) => track.warn("youtube", `Không thêm được vào danh sách phát: ${e instanceof Error ? e.message : e}`),
      );
    }

    let thumbToSet = files.thumb;
    if (files.thumbs && files.thumbs.length > 1) {
      const picked = await chooseThumbnail(videoId, id, meta.title, files.thumbs, track);
      thumbToSet = picked.file;
      await db().update(videos).set({ meta: { ...meta, thumbScores: picked.scores } }).where(eq(videos.id, videoId));
    }
    if (thumbToSet) {
      await setThumbnail(token, id, thumbToSet).then(
        () => track.log("youtube", "Đã đặt thumbnail"),
        (e) => track.warn("youtube", `Không đặt được thumbnail (kênh cần xác minh số điện thoại?): ${e instanceof Error ? e.message : e}`),
      );
    }

    let shortId: string | null = null;
    if (files.short && !v.youtubeShortId) {
      try {
        track.log("youtube", "Upload Short");
        shortId = await uploadVideo(token, {
          file: files.short,
          title: noAngle(meta.shortTitle),
          description: noAngle(meta.shortDescription),
          tags,
          publishAt: new Date(publishAt.getTime() + 2 * 3600_000),
        });
        await db().update(videos).set({ youtubeShortId: shortId }).where(eq(videos.id, videoId));
        track.tick("youtube", "short", `Short: youtu.be/${shortId}`);
      } catch (e) {
        track.warn("youtube", `Short không lên được: ${e instanceof Error ? e.message : e}`);
      }
    }

    track.finish("youtube");
    await track.flush();
    await db().update(videos).set({ status: "published", uploadStatus: "scheduled", updatedAt: new Date() }).where(eq(videos.id, videoId));
    await notify(
      `📺 <b>Đã lên lịch đăng YouTube</b>\n${escapeHtml(meta.title)}\n📅 ${slot(publishAt)}${shortId ? " (Short sau 2 giờ)" : ""}\n` +
        `https://youtu.be/${id}\n👉 ${WEB_URL}/videos/${videoId}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    track.finish("youtube", "error", msg.slice(0, 500));
    await track.flush();
    await db().update(videos).set({ uploadStatus: "failed", uploadError: msg.slice(0, 1000) }).where(eq(videos.id, videoId));
    await notify(
      `⚠️ <b>Tự đăng YouTube lỗi</b> video #${videoId}\n${escapeHtml(msg.slice(0, 300))}\n` +
        (e instanceof YoutubeAuthError ? "Vào web bấm “Kết nối YouTube” lại.\n" : "") +
        `Video vẫn sẵn sàng để đăng tay 👉 ${WEB_URL}/videos/${videoId}`,
    );
  }
}
