import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, chapters, series, videos } from "@/db/schema";
import { loadCliStatus } from "@/lib/ai/cli-status";
import { bySource, type SourceId } from "@/lib/ai/sources";
import { quotaDay } from "@/lib/ai/usage";
import { kaggleNow } from "@/lib/flow/progress";
import { loadSecrets } from "@/lib/secrets";
import type { LiveStatus } from "@/lib/live/types";
import { liveSummary } from "@/lib/studio";
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
  const [, cli] = await Promise.all([loadSecrets(), loadCliStatus()]);
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
    // Chỉ lấy tên model từ `progress` (cột nặng nhất: cảnh, prompt, nhật ký) thay vì kéo cả blob về.
    .select({
      id: videos.id,
      status: videos.status,
      agent: sql<string | null>`${videos.progress}#>>'{steps,agent,model}'`,
      images: sql<string | null>`${videos.progress}#>>'{steps,images,model}'`,
      number: chapters.number,
      seriesTitle: series.title,
    })
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
    agent: r.agent,
    images: r.images,
  }));
}

// Trạng thái gói CLI đổi rất chậm (job ai-check) — nhớ 30 giây để vòng SSE 3 giây không đọc lại mỗi lần.
let cliCache: { at: number; ok: LiveStatus["cliOk"] } | null = null;

async function cliOk(): Promise<LiveStatus["cliOk"]> {
  if (cliCache && Date.now() - cliCache.at < 30_000) return cliCache.ok;
  const cli = await loadCliStatus();
  const ok = { claude: Boolean(cli["claude-cli"]?.ok), chatgpt: Boolean(cli["codex-cli"]?.ok) };
  cliCache = { at: Date.now(), ok };
  return ok;
}

/** Trạng thái realtime gọn: video đang render + tiến độ, số video chờ, lượt dùng AI hôm nay. Hai truy vấn nhẹ (+ gói CLI có nhớ). */
export async function liveStatus(): Promise<LiveStatus> {
  const [running, today, cli] = await Promise.all([
    db()
      .select({ id: videos.id, status: videos.status, number: chapters.number, progress: videos.progress, updatedAt: videos.updatedAt })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .where(inArray(videos.status, ["rendering", "queued"]))
      .orderBy(desc(videos.status), videos.id),
    db().select().from(aiUsage).where(and(eq(aiUsage.day, quotaDay()))),
    cliOk(),
  ]);
  const r = running.find((v) => v.status === "rendering");
  return {
    rendering: r ? { id: r.id, number: r.number, updatedAt: r.updatedAt.toISOString(), ...liveSummary(r.progress) } : null,
    kaggle: kaggleNow(r?.progress),
    queued: running.filter((v) => v.status === "queued").length,
    today: bySource(today),
    cliOk: cli,
  };
}

/** Dữ liệu gọn cho thanh trên cùng (lần render server đầu tiên). */
export async function topStatus() {
  const [status, yt] = await Promise.all([liveStatus(), getYoutubeAuth().catch(() => null)]);
  return { ...status, channel: yt?.channel ?? null };
}
