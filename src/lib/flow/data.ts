import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, chapters, series, videos } from "@/db/schema";
import { LAYOUT_KEY, mergeLayout } from "./layout";
import type { FileName, FlowData } from "./model";

const FILES: FileName[] = ["long.mp4", "short.mp4", "thumbnail.jpg", "youtube.txt"];

export async function loadFlowData(videoId: number): Promise<FlowData | null> {
  const [row] = await db()
    .select({ v: videos, c: chapters, s: series })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(videos.id, videoId));
  if (!row) return null;
  const { v, c, s } = row;
  const [prev] = await db()
    .select({ summary: chapters.summary })
    .from(chapters)
    .where(and(eq(chapters.seriesId, s.id), eq(chapters.number, c.number - 1)));
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
      files: Object.fromEntries(FILES.filter((f) => v.assets[f]).map((f) => [f, `/api/videos/${v.id}/${f}`])),
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    },
    chapter: {
      id: c.id,
      number: c.number,
      title: c.title,
      words: content ? content.split(/\s+/).length : 0,
      opening: content.slice(0, 400),
      approvedAt: c.updatedAt.toISOString(),
    },
    series: { id: s.id, title: s.title, bibleExcerpt: s.bible.slice(0, 600), voiceStyle: s.voiceStyle },
    prevSummary: prev?.summary || null,
  };
}

export async function getFlowLayout() {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, LAYOUT_KEY));
  return mergeLayout(row?.value);
}
