import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { quotaDay } from "@/lib/ai/usage";
import { YT_COSTS, YT_USAGE_MODEL, type YtOp } from "@/lib/limits";

/** Cộng unit YouTube của một lệnh gọi vào tổng trong ngày (ngày Pacific như YouTube tính). Lỗi ghi log không làm hỏng việc chính. */
export async function recordYoutubeUnits(op: YtOp, times = 1) {
  if (!process.env.DATABASE_URL) return;
  const units = YT_COSTS[op] * times;
  try {
    await db()
      .insert(aiUsage)
      .values({ day: quotaDay(), model: YT_USAGE_MODEL, calls: units })
      .onConflictDoUpdate({ target: [aiUsage.day, aiUsage.model], set: { calls: sql`${aiUsage.calls} + ${units}` } });
  } catch (e) {
    console.warn("Không ghi được unit YouTube:", e instanceof Error ? e.message : e);
  }
}
