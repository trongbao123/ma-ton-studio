import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, type Chapter } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { freshInsights, loadTrends, trendsBrief } from "@/lib/trends";
import {
  bibleSchema,
  biblePrompt,
  chapterPrompt,
  outlinePrompt,
  outlineSchema,
  continuePrompt,
  summaryPrompt,
  wordCount,
} from "./prompts";

export async function draftBible(idea: string, genre: string) {
  return textProvider().generateJson({ ...biblePrompt(idea, genre), schema: bibleSchema, temperature: 1, task: "story" });
}

/** Thêm `count` chương ở trạng thái `outline` nối tiếp chương cuối hiện có. */
export async function planChapters(seriesId: number, count: number) {
  const s = await getSeries(seriesId);
  const previous = await listChapters(seriesId);
  const { chapters: drafts } = await textProvider().generateJson({
    ...outlinePrompt(s, previous, count, trendsBrief(freshInsights(await loadTrends()))),
    schema: outlineSchema,
    temperature: 0.9,
    task: "story",
  });

  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  await db()
    .insert(chapters)
    .values(
      drafts.map((d, i) => ({
        seriesId,
        number: startAt + i,
        // Model hay tự thêm "Chương N:" vào tiêu đề — UI đã hiển thị số chương.
        title: d.title.replace(/^\s*chương\s*\d+\s*[:.\-–—]\s*/i, ""),
        outline: d.outline,
      })),
    );
}

export type WriteMode = "start" | "continue" | "finish";

/**
 * Viết chương theo từng lượt để mỗi request nằm dưới maxDuration (300s) của Vercel.
 * Trình duyệt điều phối: start → continue (tới khi `enough`, tối đa 2 lần) → finish (tóm tắt, chuyển chờ duyệt).
 */
export async function writeChapterStep(chapterId: number, mode: WriteMode) {
  const chapter = await getChapter(chapterId);
  if (chapter.status === "approved") throw new Error("Chương đã duyệt — bỏ duyệt trước khi viết lại.");
  const s = await getSeries(chapter.seriesId);
  const ai = textProvider();
  let content = chapter.content;

  if (mode === "finish") {
    const summary = await ai.generateText({ ...summaryPrompt(chapter, content), temperature: 0.3, tier: "cheap", task: "summary" });
    await db().update(chapters).set({ summary, status: "draft", updatedAt: new Date() }).where(eq(chapters.id, chapterId));
  } else {
    const base = chapterPrompt(s, await previousChapters(chapter), chapter);
    const part = await ai.generateText({
      ...(mode === "start" ? base : continuePrompt(base, content, s.targetWords)),
      maxOutputTokens: 16000,
      temperature: 0.9,
      task: "story",
    });
    content = mode === "start" ? part : `${content}\n\n${part}`;
    await db()
      .update(chapters)
      .set({ content, summary: "", status: "outline", updatedAt: new Date() })
      .where(eq(chapters.id, chapterId));
  }
  const words = wordCount(content);
  return { words, enough: words >= s.targetWords * 0.8 };
}

/** Prompt đầy đủ để người dùng tự dán vào ChatGPT/Claude web nếu muốn. */
export async function manualPrompt(chapter: Chapter) {
  const s = await getSeries(chapter.seriesId);
  const p = chapterPrompt(s, await previousChapters(chapter), chapter);
  return `${p.system}\n\n${p.prompt}`;
}

function previousChapters(chapter: Chapter) {
  return db()
    .select()
    .from(chapters)
    .where(and(eq(chapters.seriesId, chapter.seriesId), lt(chapters.number, chapter.number)))
    .orderBy(asc(chapters.number));
}

export async function getSeries(id: number) {
  const [row] = await db().select().from(series).where(eq(series.id, id));
  if (!row) throw new Error(`Không tìm thấy truyện #${id}.`);
  return row;
}

export async function getChapter(id: number): Promise<Chapter> {
  const [row] = await db().select().from(chapters).where(eq(chapters.id, id));
  if (!row) throw new Error(`Không tìm thấy chương #${id}.`);
  return row;
}

export function listChapters(seriesId: number) {
  return db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
}
