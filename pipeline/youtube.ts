import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { accessToken, getYoutubeAuth, YoutubeAuthError } from "@/lib/youtube";
import { Tracker } from "./progress";
import { keepOrNextSlot } from "./schedule";

type Upload = { file: string; title: string; description: string; tags: string[]; publishAt: Date };

/** Upload resumable: xin URL phiên rồi PUT cả file (stream, không nạp vào RAM). Trả id video YouTube. */
async function uploadVideo(token: string, u: Upload) {
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
        // Lên lịch: để riêng tư tới đúng giờ thì YouTube tự công khai.
        privacyStatus: "private",
        publishAt: u.publishAt.toISOString(),
        selfDeclaredMadeForKids: false,
        // Nhãn "nội dung đã chỉnh sửa/tổng hợp" bắt buộc với giọng đọc + ảnh AI.
        containsSyntheticMedia: true,
      },
    }),
  });
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

async function setThumbnail(token: string, videoId: string, file: string) {
  const res = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg" },
    body: new Uint8Array(await readFile(file)),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

const slot = (d: Date) =>
  d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * Tự đăng video đã render lên YouTube theo lịch. Bỏ qua khi: tắt tự đăng, chưa kết nối, đã đăng rồi (chống trùng),
 * hoặc không chạy trên GitHub Actions. Lỗi upload không làm hỏng video: giữ `ready` để đăng tay.
 */
export async function publishToYoutube(videoId: number, files: { long: string; short?: string; thumb?: string }) {
  const [row] = await db()
    .select({ v: videos, autoPublish: series.autoPublish })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(videos.id, videoId));
  const v = row?.v;
  if (!v || !v.meta || (v.status !== "ready" && v.status !== "published")) return;
  if (!process.env.GITHUB_ACTIONS || !row.autoPublish || v.youtubeVideoId) return;
  const auth = await getYoutubeAuth();
  if (!auth) return console.log("Chưa kết nối YouTube — bỏ qua tự đăng.");

  const track = new Tracker(videoId, v.progress);
  track.start("youtube", { long: 1, ...(files.short ? { short: 1 } : {}) });
  await db().update(videos).set({ uploadStatus: "uploading", uploadError: null }).where(eq(videos.id, videoId));
  try {
    const token = await accessToken(auth.refreshToken);
    const publishAt = await keepOrNextSlot(v.publishAt);
    const meta = v.meta;

    track.log("youtube", "Upload video dài");
    const id = await uploadVideo(token, { file: files.long, title: meta.title, description: meta.description, tags: meta.tags, publishAt });
    // Lưu id ngay: lỗi ở bước sau cũng không upload trùng lần nữa.
    await db().update(videos).set({ youtubeVideoId: id, youtubeUrl: `https://youtu.be/${id}`, publishAt }).where(eq(videos.id, videoId));
    track.tick("youtube", "long", `Video dài: youtu.be/${id}`);

    if (files.thumb) {
      await setThumbnail(token, id, files.thumb).then(
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
          title: meta.shortTitle,
          description: meta.shortDescription,
          tags: meta.tags,
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
