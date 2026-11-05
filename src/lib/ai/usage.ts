import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";

/** Ngày quota hiện tại theo giờ Pacific (Google reset free tier lúc nửa đêm Pacific ≈ 14–15h Việt Nam). */
export function quotaDay(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** Ghi nhận 1 lượt gọi (hoặc 1 lần bị chặn vì hết quota). Lỗi ghi log không được làm hỏng việc chính. */
export async function recordUsage(model: string, limited: boolean) {
  if (!process.env.DATABASE_URL) return;
  try {
    await db()
      .insert(aiUsage)
      .values({ day: quotaDay(), model, calls: limited ? 0 : 1, limited })
      .onConflictDoUpdate({
        target: [aiUsage.day, aiUsage.model],
        set: limited ? { limited: true } : { calls: sql`${aiUsage.calls} + 1` },
      });
  } catch (e) {
    console.warn("Không ghi được usage:", e);
  }
}
