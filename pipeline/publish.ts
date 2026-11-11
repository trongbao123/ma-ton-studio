import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { THUMB_IDS, thumbFile } from "./thumb-plan";
import { publishToYoutube } from "./youtube";

const run = promisify(execFile);

/** Đăng lại YouTube cho video đã render (vd lần trước token hỏng): tải file từ release về rồi upload, không render lại. */
async function main(videoId: number) {
  await loadSecrets(true);
  const dir = await mkdtemp(path.join(tmpdir(), `publish-${videoId}-`));
  await run("gh", ["release", "download", `video-${videoId}`, "--repo", process.env.GITHUB_REPOSITORY!, "--dir", dir, "--pattern", "*.mp4", "--pattern", "thumbnail.jpg", "--pattern", "thumb-?.jpg"]);
  const files = await readdir(dir);
  if (!files.includes("long.mp4")) throw new Error("Release không có long.mp4 — render lại video.");
  await publishToYoutube(videoId, {
    long: path.join(dir, "long.mp4"),
    short: files.includes("short.mp4") ? path.join(dir, "short.mp4") : undefined,
    thumb: files.includes("thumbnail.jpg") ? path.join(dir, "thumbnail.jpg") : undefined,
    thumbs: THUMB_IDS.filter((id) => files.includes(thumbFile(id))).map((id) => ({ id, file: path.join(dir, thumbFile(id)) })),
  });
}

// CLI: tsx pipeline/publish.ts <videoId>
const videoId = Number(process.argv[2]);
main(videoId).then(
  () => process.exit(0),
  async (e) => {
    console.error(e);
    // Lỗi trước khi kịp upload (tải release hỏng…) → báo failed để nút "Đăng lại" hiện lại, không kẹt ở "đang upload".
    const msg = e instanceof Error ? e.message : String(e);
    await db().update(videos).set({ uploadStatus: "failed", uploadError: msg.slice(0, 1000) }).where(eq(videos.id, videoId)).catch(() => {});
    process.exit(1);
  },
);
