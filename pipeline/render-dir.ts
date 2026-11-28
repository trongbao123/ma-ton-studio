import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const OWNER_FILE = ".owner";

/**
 * Nhãn chủ của thư mục render: id + thời điểm tạo row. Id lặp lại được (23/11/2026 chuyển Neon → Supabase, id đếm lại từ 1)
 * nên chỉ id thôi không đủ phân biệt video cũ với video mới trùng số.
 */
export function renderDirOwner(videoId: number, createdAt: Date): string {
  return `${videoId}@${createdAt.toISOString()}`;
}

/**
 * Bảo đảm thư mục render (được cache Actions mang từ lượt trước) đúng là của video này. Thiếu nhãn hoặc nhãn khác → xoá sạch
 * rồi ghi nhãn mới, để không dùng nhầm ảnh/giọng của video khác trùng id (lỗi #11–#21 chuyện đời, 24–28/11/2026).
 * @returns true nếu đã xoá thư mục cũ.
 */
export async function claimRenderDir(dir: string, owner: string): Promise<boolean> {
  const current = await readFile(path.join(dir, OWNER_FILE), "utf8").catch(() => null);
  if (current?.trim() === owner) return false;
  const existed = current !== null || (await stat(dir).then(() => true, () => false));
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, OWNER_FILE), owner);
  return existed;
}
