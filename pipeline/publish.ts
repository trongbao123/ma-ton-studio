import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { publishToYoutube } from "./youtube";

const run = promisify(execFile);

/** Đăng lại YouTube cho video đã render (vd lần trước token hỏng): tải file từ release về rồi upload, không render lại. */
async function main(videoId: number) {
  const [v] = await db().select({ status: videos.status }).from(videos).where(eq(videos.id, videoId));
  if (!v) throw new Error(`Không có video #${videoId}`);
  const dir = await mkdtemp(path.join(tmpdir(), `publish-${videoId}-`));
  await run("gh", ["release", "download", `video-${videoId}`, "--repo", process.env.GITHUB_REPOSITORY!, "--dir", dir, "--pattern", "*.mp4", "--pattern", "thumbnail.jpg"]);
  const files = await readdir(dir);
  if (!files.includes("long.mp4")) throw new Error("Release không có long.mp4 — render lại video.");
  await publishToYoutube(videoId, {
    long: path.join(dir, "long.mp4"),
    short: files.includes("short.mp4") ? path.join(dir, "short.mp4") : undefined,
    thumb: files.includes("thumbnail.jpg") ? path.join(dir, "thumbnail.jpg") : undefined,
  });
}

// CLI: tsx pipeline/publish.ts <videoId>
main(Number(process.argv[2])).then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
