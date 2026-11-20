// Thay bản đã hẹn giờ trên YouTube bằng bản render mới (vd thêm nhạc) — CHỈ khi video CHƯA công chiếu (chưa có view).
// Xoá video + Short cũ, giữ nguyên giờ hẹn, rồi đăng lại từ file trên release. CLI: render.ts "replace:<videoId>".
import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { accessToken, channelOfVideo, getYoutubeAuth } from "@/lib/youtube";
import { publishToYoutube } from "./youtube";

const run = promisify(execFile);

export async function replaceOnYoutube(videoId: number) {
  await loadSecrets(true);
  const [v] = await db().select().from(videos).where(eq(videos.id, videoId));
  if (!v) throw new Error(`Không có video #${videoId}.`);
  if (!v.youtubeVideoId) throw new Error(`Video #${videoId} chưa có trên YouTube — dùng nút Đăng.`);
  if (!v.publishAt || v.publishAt.getTime() < Date.now() + 30 * 60_000) throw new Error("Video đã/sắp công chiếu — không xoá (mất view).");
  if (v.status !== "published") throw new Error(`Video #${videoId} đang ${v.status} — chờ render xong.`);
  // Tải file mới TRƯỚC khi xoá bản cũ: thiếu file thì dừng, bản cũ vẫn còn.
  const dir = await mkdtemp(path.join(tmpdir(), `replace-${videoId}-`));
  await run("gh", ["release", "download", `video-${videoId}`, "--repo", process.env.GITHUB_REPOSITORY!, "--dir", dir, "--pattern", "long.mp4", "--pattern", "thumbnail.jpg"]);
  const files = await readdir(dir);
  if (!files.includes("long.mp4")) throw new Error("Release không có long.mp4.");
  const auth = await getYoutubeAuth(await channelOfVideo(videoId));
  if (!auth) throw new Error("Chưa kết nối YouTube.");
  const token = await accessToken(auth.refreshToken);
  for (const id of [v.youtubeVideoId, v.youtubeShortId]) {
    if (!id) continue;
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok && res.status !== 404) throw new Error(`Xoá ${id} lỗi: ${res.status} ${(await res.text()).slice(0, 200)}`);
    console.log(`  🗑 Đã xoá bản cũ youtu.be/${id} (chưa công chiếu)`);
  }
  // Giữ publishAt → publishToYoutube (keepOrNextSlot) đăng lại đúng giờ hẹn cũ.
  await db().update(videos).set({ youtubeVideoId: null, youtubeUrl: null, youtubeShortId: null, uploadStatus: "uploading", uploadError: null }).where(eq(videos.id, videoId));
  await publishToYoutube(videoId, {
    long: path.join(dir, "long.mp4"),
    thumb: files.includes("thumbnail.jpg") ? path.join(dir, "thumbnail.jpg") : undefined,
  });
  const [after] = await db().select({ yt: videos.youtubeVideoId, at: videos.publishAt }).from(videos).where(eq(videos.id, videoId));
  console.log(`✔ #${videoId} đã thay: youtu.be/${after?.yt} — công chiếu ${after?.at?.toISOString()}`);
}
