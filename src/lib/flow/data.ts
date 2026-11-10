import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, appSettings, chapters, series, videos } from "@/db/schema";
import { LAYOUT_KEY, mergeLayout } from "./layout";
import { configuredImageModel, containingCompilation, pickImageModel, type CompilationRef } from "./derive";
import { IMAGE_ROUTING_KEY, normalizeImageRouting } from "@/lib/ai/routing";
import { quotaDay } from "@/lib/ai/usage";
import { INSIGHT_MAX_AGE_DAYS, loadTrends, scannedWithin, type TrendsData } from "@/lib/trends";
import { availableProviders, loadRouting } from "@/lib/ai";
import { loadCliStatus, withCliStatus } from "@/lib/ai/cli-status";
import { loadSecrets } from "@/lib/secrets";
import { getYoutubeAuth } from "@/lib/youtube";
import type { FlowData, TrendsView } from "./model";

/** Rút gọn kết quả quét xu hướng cho màn flow (không gửi dữ liệu thô). */
function trendsView(t: TrendsData | null): TrendsView | null {
  if (!t) return null;
  const i = t.insights;
  return {
    scannedAt: t.scannedAt,
    fresh: scannedWithin(t, INSIGHT_MAX_AGE_DAYS),
    summary: i?.summary ?? "",
    hotTopics: (i?.hotTopics ?? []).slice(0, 5).map((x) => ({ topic: x.topic, why: x.why })),
    titlePatterns: (i?.titlePatterns ?? []).slice(0, 5),
    risingKeywords: (i?.risingKeywords ?? []).slice(0, 8),
  };
}

/** Các bản gộp có chứa video chương này (lọc ở DB bằng jsonb, chọn bản mới nhất bằng hàm thuần). */
async function compilationsOf(videoId: number): Promise<CompilationRef | null> {
  const rows = await db()
    .select({ id: videos.id, meta: videos.meta, status: videos.status, youtubeVideoId: videos.youtubeVideoId })
    .from(videos)
    .where(sql`${videos.meta}->'compilation'->'videoIds' @> ${JSON.stringify([videoId])}::jsonb`);
  const refs = rows.flatMap((r) =>
    r.meta?.compilation
      ? [{ id: r.id, from: r.meta.compilation.from, to: r.meta.compilation.to, videoIds: r.meta.compilation.videoIds, youtubeVideoId: r.youtubeVideoId, status: r.status }]
      : [],
  );
  return containingCompilation(videoId, refs);
}

export async function loadFlowData(videoId: number): Promise<FlowData | null> {
  const [row] = await db()
    .select({ v: videos, c: chapters, s: series })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(videos.id, videoId));
  if (!row) return null;
  const { v, c, s } = row;
  const tracked = v.progress?.steps.images?.model;
  const [[prev], yt, [img], routing, , cli, trends, compiledInto, usage] = await Promise.all([
    db()
      .select({ summary: chapters.summary })
      .from(chapters)
      .where(and(eq(chapters.seriesId, s.id), eq(chapters.number, c.number - 1))),
    getYoutubeAuth(),
    db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, IMAGE_ROUTING_KEY)),
    loadRouting(true),
    loadSecrets(),
    loadCliStatus(),
    loadTrends(),
    compilationsOf(v.id),
    // Pipeline chưa ghi model ảnh (video cũ) thì suy từ lượt dùng trong ngày render.
    tracked ? Promise.resolve([]) : db().select({ model: aiUsage.model, calls: aiUsage.calls }).from(aiUsage).where(eq(aiUsage.day, quotaDay(v.updatedAt))),
  ]);
  const content = c.content.trim();

  return {
    video: {
      id: v.id,
      status: v.status,
      error: v.error,
      runUrl: v.runUrl,
      publishAt: v.publishAt?.toISOString() ?? null,
      durationSec: v.durationSec,
      youtubeUrl: v.youtubeUrl,
      meta: v.meta,
      files: Object.fromEntries(Object.keys(v.assets).map((f) => [f, `/api/videos/${v.id}/${f}`])),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      progress: v.progress,
      uploadStatus: v.uploadStatus,
      uploadError: v.uploadError,
      youtubeVideoId: v.youtubeVideoId,
      youtubeShortId: v.youtubeShortId,
    },
    chapter: {
      id: c.id,
      number: c.number,
      title: c.title,
      words: content ? content.split(/\s+/).length : 0,
      content,
      outline: c.outline,
      approvedAt: c.updatedAt.toISOString(),
    },
    series: {
      id: s.id,
      title: s.title,
      bibleExcerpt: s.bible.slice(0, 600),
      voiceStyle: s.voiceStyle,
      ttsVoice: s.ttsVoice,
      makeShort: s.makeShort,
      autoPublish: s.autoPublish,
    },
    prevSummary: prev?.summary || null,
    youtube: { connected: Boolean(yt), channel: yt?.channel ?? null },
    trends: trendsView(trends),
    compiledInto,
    ai: {
      image: pickImageModel({ tracked, usage, configured: configuredImageModel(normalizeImageRouting(img?.value), Boolean(process.env.CODEX_AUTH_JSON)) }),
      text: { story: routing.story, meta: routing.meta, scenes: routing.scenes },
      available: withCliStatus(availableProviders(), cli),
    },
  };
}

export async function getFlowLayout() {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAYOUT_KEY));
  return mergeLayout(row?.value);
}
