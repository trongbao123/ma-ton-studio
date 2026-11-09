import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

const run = promisify(execFile);

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".txt": "text/plain; charset=utf-8",
};

function gh() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  return process.env.GITHUB_ACTIONS && repo && token ? { repo, token } : null;
}

/**
 * Release `video-<id>` chứa mọi file của video. Tạo từ đầu job để upload ảnh/giọng ngay khi xong (màn flow thấy liền).
 * `fresh`: xoá release và danh sách asset cũ — dùng khi render lại video chưa đăng YouTube.
 * Không chạy trên GitHub Actions thì trả null (không upload).
 */
export async function ensureRelease(videoId: number, fresh: boolean): Promise<number | null> {
  const g = gh();
  if (!g) {
    console.log("Không chạy trong GitHub Actions — bỏ qua upload release.");
    return null;
  }
  const tag = `video-${videoId}`;
  if (fresh) {
    await run("gh", ["release", "delete", tag, "--repo", g.repo, "--yes", "--cleanup-tag"]).catch(() => {});
    await db().update(videos).set({ assets: {} }).where(eq(videos.id, videoId));
  } else {
    const found = await run("gh", ["api", `repos/${g.repo}/releases/tags/${tag}`, "--jq", ".id"]).catch(() => null);
    if (found) return Number(found.stdout.trim());
  }
  await run("gh", ["release", "create", tag, "--repo", g.repo, "--title", tag, "--notes", "Ma Tôn Studio render"]);
  const { stdout } = await run("gh", ["api", `repos/${g.repo}/releases/tags/${tag}`, "--jq", ".id"]);
  return Number(stdout.trim());
}

/** Upload 1 file vào release (thay file trùng tên) rồi ghép `{tên: asset id}` vào `videos.assets`. */
export async function uploadAsset(videoId: number, releaseId: number | null, file: string, name = path.basename(file)) {
  const g = gh();
  if (!g || !releaseId) return;
  const headers = { Authorization: `Bearer ${g.token}`, Accept: "application/vnd.github+json" };
  const [v] = await db().select({ assets: videos.assets }).from(videos).where(eq(videos.id, videoId));
  const old = v?.assets[name];
  if (old) await fetch(`https://api.github.com/repos/${g.repo}/releases/assets/${old}`, { method: "DELETE", headers });

  const size = (await stat(file)).size;
  const res = await fetch(`https://uploads.github.com/repos/${g.repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": TYPES[path.extname(name)] ?? "application/octet-stream", "Content-Length": String(size) },
    body: Readable.toWeb(createReadStream(file)) as ReadableStream,
    duplex: "half",
  } as RequestInit);
  if (!res.ok) throw new Error(`Upload ${name} lỗi: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { id } = (await res.json()) as { id: number };
  await db()
    .update(videos)
    .set({ assets: sql`${videos.assets} || ${JSON.stringify({ [name]: id })}::jsonb` })
    .where(eq(videos.id, videoId));
}
