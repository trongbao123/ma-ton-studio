import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, chapters, series, videos } from "@/db/schema";
import { LAYOUT_KEY, mergeLayout } from "./layout";
import { DEFAULT_IMAGE_MODEL, IMAGE_ROUTING_KEY, normalizeImageRouting } from "@/lib/ai/routing";
import { getYoutubeAuth } from "@/lib/youtube";
import type { FlowData } from "./model";

export async function loadFlowData(videoId: number): Promise<FlowData | null> {
  const [row] = await db()
    .select({ v: videos, c: chapters, s: series })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(videos.id, videoId));
  if (!row) return null;
  const { v, c, s } = row;
  const [[prev], yt, [img]] = await Promise.all([
    db()
      .select({ summary: chapters.summary })
      .from(chapters)
      .where(and(eq(chapters.seriesId, s.id), eq(chapters.number, c.number - 1))),
    getYoutubeAuth(),
    db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, IMAGE_ROUTING_KEY)),
  ]);
  const firstImage = normalizeImageRouting(img?.value)[0];
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
    ai: { imageModel: firstImage.model || DEFAULT_IMAGE_MODEL[firstImage.provider] },
  };
}

export async function getFlowLayout() {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAYOUT_KEY));
  return mergeLayout(row?.value);
}
