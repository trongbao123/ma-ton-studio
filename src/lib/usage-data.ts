import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, chapters, series, videos } from "@/db/schema";
import { loadCliStatus } from "@/lib/ai/cli-status";
import { bySource, type SourceId } from "@/lib/ai/sources";
import { quotaDay } from "@/lib/ai/usage";
import { loadSecrets } from "@/lib/secrets";
import { getYoutubeAuth } from "@/lib/youtube";

/** n ngày quota gần nhất (theo giờ Mỹ như Google tính), mới nhất trước. */
export function lastQuotaDays(n = 7, now = new Date()) {
  const days: string[] = [];
  for (let i = 0; days.length < n && i < n * 2; i++) {
    const d = quotaDay(new Date(now.getTime() - i * 86_400_000));
    if (!days.includes(d)) days.push(d);
  }
  return days;
}

/** Lượt dùng theo nguồn cho từng ngày trong `days`. */
export async function usageByDay(days: string[]) {
  const rows = await db().select().from(aiUsage).where(inArray(aiUsage.day, days));
  return Object.fromEntries(days.map((d) => [d, bySource(rows.filter((r) => r.day === d))]));
}

/** Nguồn nào đã cấu hình (có key / gói đã kết nối) — trang Hạn mức phân biệt "chưa dùng" với "chưa có". */
export async function configuredSources(): Promise<Partial<Record<SourceId, boolean>>> {
  await loadSecrets();
  const cli = await loadCliStatus();
  const has = (k: string) => Boolean(process.env[k]);
  return {
    "claude-plan": Boolean(cli["claude-cli"]?.ok),
    "chatgpt-plan": Boolean(cli["codex-cli"]?.ok),
    "gemini-free": has("GEMINI_API_KEY"),
    voice: has("GEMINI_API_KEY"),
    // Token Cloudflare chỉ nằm ở GitHub Secrets (job render dùng) — Vercel không thấy; đây là AI vẽ mặc định nên coi như có.
    cloudflare: true,
    deepinfra: has("DEEPINFRA_API_KEY"),
    "claude-api": has("ANTHROPIC_API_KEY"),
    "openai-api": has("OPENAI_API_KEY"),
  };
}

/** Video gần nhất và AI đã làm từng bước (ghi trong progress khi render). */
export async function recentAiWork(limit = 8) {
  const rows = await db()
    .select({ id: videos.id, status: videos.status, progress: videos.progress, number: chapters.number, seriesTitle: series.title })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .orderBy(desc(videos.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    number: r.number,
    seriesTitle: r.seriesTitle,
    agent: r.progress?.steps.agent?.model ?? null,
    images: r.progress?.steps.images?.model ?? null,
  }));
}

/** Dữ liệu gọn cho thanh trên cùng. */
export async function topStatus() {
  const [running, today, cli, yt] = await Promise.all([
    db()
      .select({ id: videos.id, status: videos.status, number: chapters.number })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .where(inArray(videos.status, ["rendering", "queued"]))
      .orderBy(desc(videos.status), videos.id),
    db().select().from(aiUsage).where(and(eq(aiUsage.day, quotaDay()))),
    loadCliStatus(),
    getYoutubeAuth().catch(() => null),
  ]);
  return {
    rendering: running.find((v) => v.status === "rendering") ?? null,
    queued: running.filter((v) => v.status === "queued").length,
    today: bySource(today),
    cli,
    channel: yt?.channel ?? null,
  };
}
