import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { aiUsage, appSettings, chapters, series, videos } from "@/db/schema";
import { LAYOUT_KEY, LAYOUT_KEY_H, mergeLayout } from "./layout";
import { configuredImageModel, containingCompilation, pickImageModel, type CompilationRef } from "./derive";
import { IMAGE_ROUTING_KEY, normalizeImageRouting, normalizeRouting, ROUTING_KEY } from "@/lib/ai/routing";
import { assetUrl } from "@/lib/asset-url";
import { quotaDay } from "@/lib/ai/usage";
import { INSIGHT_MAX_AGE_DAYS, scannedWithin, TRENDS_KEY, type TrendsData } from "@/lib/trends";
import { availableProviders } from "@/lib/ai";
import { CLI_STATUS_KEY, withCliStatus, type CliStatus } from "@/lib/ai/cli-status";
import { applySecrets, secretsFresh } from "@/lib/secrets";
import { SECRETS_KEY } from "@/lib/secret-keys";
import { parseYoutubeAuth, YT_KEY } from "@/lib/youtube";
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

/** Truy vấn các bản gộp có chứa video chương này (lọc ở DB bằng jsonb). */
const compilationRows = (videoId: number) =>
  db()
    .select({ id: videos.id, meta: videos.meta, status: videos.status, youtubeVideoId: videos.youtubeVideoId })
    .from(videos)
    .where(sql`${videos.meta}->'compilation'->'videoIds' @> ${JSON.stringify([videoId])}::jsonb`);

/** Chọn bản gộp mới nhất bằng hàm thuần. */
function compilationOf(videoId: number, rows: Awaited<ReturnType<typeof compilationRows>>): CompilationRef | null {
  const refs = rows.flatMap((r) =>
    r.meta?.compilation
      ? [{ id: r.id, from: r.meta.compilation.from, to: r.meta.compilation.to, videoIds: r.meta.compilation.videoIds, youtubeVideoId: r.youtubeVideoId, status: r.status }]
      : [],
  );
  return containingCompilation(videoId, refs);
}

/** Mọi khoá app_settings màn flow cần — đọc MỘT lần thay vì 7 truy vấn riêng. */
const SETTING_KEYS = [SECRETS_KEY, YT_KEY, ROUTING_KEY, IMAGE_ROUTING_KEY, CLI_STATUS_KEY, TRENDS_KEY, LAYOUT_KEY, LAYOUT_KEY_H];

/**
 * Dữ liệu màn flow + bố cục đã lưu. Đúng 2 vòng tới DB: (1) video + chương + truyện + tóm tắt chương trước;
 * (2) một lô gồm toàn bộ app_settings cần, các bản gộp, lượt dùng ảnh — gửi chung một request HTTP.
 */
export async function loadFlowPage(
  videoId: number,
): Promise<{ data: FlowData; layout: ReturnType<typeof mergeLayout>; layoutH: ReturnType<typeof mergeLayout> } | null> {
  const prev = alias(chapters, "prev_chapter");
  const [row] = await db()
    .select({ v: videos, c: chapters, s: series, prevSummary: prev.summary })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .leftJoin(prev, and(eq(prev.seriesId, chapters.seriesId), eq(prev.number, sql`${chapters.number} - 1`)))
    .where(eq(videos.id, videoId));
  if (!row) return null;
  const { v, c, s } = row;
  const tracked = v.progress?.steps.images?.model;
  const [settingRows, compRows, usage] = await db().batch([
    db().select({ key: appSettings.key, value: appSettings.value }).from(appSettings).where(inArray(appSettings.key, SETTING_KEYS)),
    compilationRows(v.id),
    // Pipeline chưa ghi model ảnh (video cũ) thì suy từ lượt dùng trong ngày render; đã ghi thì lô này trả rỗng.
    db()
      .select({ model: aiUsage.model, calls: aiUsage.calls })
      .from(aiUsage)
      .where(tracked ? sql`false` : eq(aiUsage.day, quotaDay(v.updatedAt))),
  ]);
  const setting = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  if (process.env.DATABASE_URL && !secretsFresh()) applySecrets(setting[SECRETS_KEY]);
  const routing = normalizeRouting(setting[ROUTING_KEY] ?? null);
  const cli = (setting[CLI_STATUS_KEY] ?? {}) as CliStatus;
  const yt = parseYoutubeAuth(setting[YT_KEY]);
  const trends = (setting[TRENDS_KEY] as TrendsData | undefined) ?? null;
  const compiledInto = compilationOf(v.id, compRows);
  const content = c.content.trim();

  const data: FlowData = {
    video: {
      id: v.id,
      status: v.status,
      error: v.error,
      runUrl: v.runUrl,
      publishAt: v.publishAt?.toISOString() ?? null,
      durationSec: v.durationSec,
      youtubeUrl: v.youtubeUrl,
      meta: v.meta,
      files: Object.fromEntries(Object.entries(v.assets).map(([f, assetId]) => [f, assetUrl(v.id, f, assetId)])),
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
    prevSummary: row.prevSummary || null,
    youtube: { connected: Boolean(yt), channel: yt?.channel ?? null },
    trends: trendsView(trends),
    compiledInto,
    ai: {
      image: pickImageModel({ tracked, usage, configured: configuredImageModel(normalizeImageRouting(setting[IMAGE_ROUTING_KEY]), Boolean(process.env.CODEX_AUTH_JSON)) }),
      text: { story: routing.story, meta: routing.meta, scenes: routing.scenes },
      available: withCliStatus(availableProviders(), cli),
    },
  };
  return { data, layout: mergeLayout(setting[LAYOUT_KEY]), layoutH: mergeLayout(setting[LAYOUT_KEY_H], "h") };
}

/** Dữ liệu màn flow (không kèm bố cục) — cho API / luồng SSE. */
export async function loadFlowData(videoId: number): Promise<FlowData | null> {
  return (await loadFlowPage(videoId))?.data ?? null;
}
