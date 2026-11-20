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

/**
 * Link tải công khai có chữ ký (hết hạn ~5 phút) của 1 asset trong repo private — để dịch vụ ngoài (vidIQ) đọc ảnh mà không cần token.
 * GitHub trả 302 tới objects.githubusercontent.com kèm chữ ký; ta lấy chính link đó. Không có asset / không chạy trên Actions → null.
 */
export async function signedAssetUrl(videoId: number, name: string): Promise<string | null> {
  const g = gh();
  if (!g) return null;
  const [v] = await db().select({ assets: videos.assets }).from(videos).where(eq(videos.id, videoId));
  const assetId = v?.assets[name];
  if (!assetId) return null;
  const res = await fetch(`https://api.github.com/repos/${g.repo}/releases/assets/${assetId}`, {
    headers: { Authorization: `Bearer ${g.token}`, Accept: "application/octet-stream" },
    redirect: "manual",
  });
  return res.headers.get("location");
}

/**
 * Máy render không còn ảnh (cache Actions mất / truyện sửa) mà release cũ còn ảnh → tải về để dùng lại, khỏi vẽ lại.
 * Ảnh Short (`short-img-*`) về `shortDir`. Trả số ảnh tải được (0 nếu không có release hoặc không chạy trên Actions).
 */
export async function restoreImages(videoId: number, dir: string, shortDir: string): Promise<number> {
  const g = gh();
  if (!g) return 0;
  const tag = `video-${videoId}`;
  const get = (pattern: string, to: string) =>
    run("gh", ["release", "download", tag, "--repo", g.repo, "-p", pattern, "-D", to, "--skip-existing"]).catch(() => null);
  await get("long-img-*", dir);
  await get("short-img-*", shortDir);
  const { readdir } = await import("node:fs/promises");
  const count = async (d: string) => (await readdir(d).catch(() => [] as string[])).filter((f) => /-img-\d+\.jpg$/.test(f)).length;
  return (await count(dir)) + (await count(shortDir));
}

/** File giọng gốc đáng giữ (đã trả tiền ivoi / tốn lượt Gemini) — bỏ bản đổi nhịp (-x0.9…) và file tạm (dựng lại được, không tốn tiền). */
const isPaidTts = (f: string) => /^tts-.*\.wav$/.test(f) && !/-x[\d.]+\.wav$|\.tmp\.wav$/.test(f);

/**
 * Giọng đọc đã trả tiền lưu vào release (`tts-cache.tar`) — cache Actions chỉ 10GB/repo, video 90 phút 5–7GB nên cache
 * đẩy nhau ra và job chết giữa chừng (timeout) không kịp lưu → lần sau đọc lại = trả tiền lại (#88 ngày 19/11/2026).
 */
export async function saveTts(videoId: number, releaseId: number | null, dir: string) {
  if (!gh() || !releaseId) return;
  const { readdir } = await import("node:fs/promises");
  // Kèm kịch bản phân vai: mất nó thì AI chia lời lại khác → đoạn không khớp file/job cũ → đọc lại (trả tiền).
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => isPaidTts(f) || /^voice-script.*\.json$/.test(f));
  // Giọng mở đầu kiểu Short (thư mục cold/) cũng đã trả tiền.
  files.push(...(await readdir(path.join(dir, "cold")).catch(() => [] as string[])).filter(isPaidTts).map((f) => `cold/${f}`));
  if (!files.length) return;
  const tar = path.join(dir, "tts-cache.tar");
  await run("tar", ["-cf", tar, "-C", dir, ...files], { maxBuffer: 1 << 26 });
  await uploadAsset(videoId, releaseId, tar);
  console.log(`  Đã lưu ${files.length} file giọng vào release (không phải đọc lại nếu job sau mất cache)`);
}

/** Chưa có file giọng (cache mất) mà release còn `tts-cache.tar` → tải về TRƯỚC khi ensureRelease xoá release. Trả số file. */
export async function restoreTts(videoId: number, dir: string): Promise<number> {
  const g = gh();
  if (!g) return 0;
  const { readdir } = await import("node:fs/promises");
  const have = async () =>
    (await readdir(dir).catch(() => [] as string[])).filter(isPaidTts).length + (await readdir(path.join(dir, "cold")).catch(() => [] as string[])).filter(isPaidTts).length;
  const before = await have();
  const got = await run("gh", ["release", "download", `video-${videoId}`, "--repo", g.repo, "-p", "tts-cache.tar", "-D", dir, "--clobber"]).catch(() => null);
  if (!got) return 0;
  // -k: không ghi đè file đã có (bản trong cache Actions mới hơn hoặc bằng).
  await run("tar", ["-xkf", path.join(dir, "tts-cache.tar"), "-C", dir]).catch(() => null);
  return (await have()) - before;
}
