import { db } from "@/db";
import { videos } from "@/db/schema";

/** Tạo bản ghi video `queued` và báo GitHub Actions render. Không có GH_TOKEN thì job hằng ngày sẽ nhặt. */
export async function queueVideo(chapterId: number) {
  const [v] = await db().insert(videos).values({ chapterId }).returning({ id: videos.id });
  await dispatchRender(v.id);
  return v.id;
}

export function dispatchRender(videoId: number) {
  return dispatch("render.yml", videoId);
}

/** Đăng lại YouTube từ file đã render (workflow publish.yml). */
export function dispatchPublish(videoId: number) {
  return dispatch("publish.yml", videoId);
}

/** Lệnh CLI của pipeline (render.ts) chạy trên GitHub Actions, vd "historyscript:9", "factcheck:120". */
export function dispatchCommand(command: string) {
  return dispatch("render.yml", command);
}

/** Quét xu hướng YouTube (render.yml với video_id = "trends"). */
export function dispatchTrends() {
  return dispatch("render.yml", "trends");
}

async function dispatch(workflow: string, videoId: number | string) {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GH_REPO;
  if (!token || !repo || process.env.GITHUB_ACTIONS) return false;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs: { video_id: String(videoId) } }),
  });
  if (!res.ok) throw new Error(`Không gọi được GitHub Actions: ${res.status} ${await res.text()}`);
  return true;
}
