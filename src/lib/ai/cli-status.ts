import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { ProviderId } from "./routing";

/**
 * Kết quả gọi thử gần nhất của các gói AI qua CLI (job ai-check ghi). Đăng nhập gói nằm ở GitHub Secrets nên Vercel
 * không thấy — web đọc bản ghi này để hiện "đã kết nối" và cho chọn AI đó.
 */
export type CliCheck = { ok: boolean; model?: string; error?: string; at: string };
export type CliStatus = Partial<Record<ProviderId, CliCheck>>;

const KEY = "ai_cli_status";

export async function loadCliStatus(): Promise<CliStatus> {
  if (!process.env.DATABASE_URL) return {};
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY)).catch(() => []);
  return (row?.value ?? {}) as CliStatus;
}

export async function saveCliStatus(value: CliStatus) {
  await db()
    .insert(appSettings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/** Hãng hiện là "có thể dùng" trên giao diện: có key ở đây, hoặc gói CLI đã gọi thử thành công trên GitHub Actions. */
export function withCliStatus(available: ProviderId[], status: CliStatus): ProviderId[] {
  const ok = (Object.keys(status) as ProviderId[]).filter((p) => status[p]?.ok);
  return [...new Set([...available, ...ok])];
}
