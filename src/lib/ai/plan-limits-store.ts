import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { PLAN_LIMITS_KEY, type PlanLimits, type PlanSnapshot } from "./plan-limits";

export async function loadPlanLimits(): Promise<PlanLimits> {
  if (!process.env.DATABASE_URL) return {};
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PLAN_LIMITS_KEY)).catch(() => []);
  return (row?.value ?? {}) as PlanLimits;
}

/** Ghi đè snapshot của MỘT gói, giữ nguyên gói kia. Lỗi DB chỉ cảnh báo — không làm hỏng việc chính. */
export async function savePlanLimits(which: keyof PlanLimits, snap: PlanSnapshot) {
  if (!process.env.DATABASE_URL) return;
  try {
    const value: PlanLimits = { ...(await loadPlanLimits()), [which]: snap };
    await db().insert(appSettings).values({ key: PLAN_LIMITS_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  } catch (e) {
    console.warn("Không lưu được hạn mức gói:", e instanceof Error ? e.message : e);
  }
}
