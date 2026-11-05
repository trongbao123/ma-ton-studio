import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, type Chapter } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import {
  bibleSchema,
  biblePrompt,
  chapterPrompt,
  outlinePrompt,
  outlineSchema,
  summaryPrompt,
} from "./prompts";

export async function draftBible(idea: string, genre: string) {
  return textProvider().generateJson({ ...biblePrompt(idea, genre), schema: bibleSchema, temperature: 1 });
}

/** Thêm `count` chương ở trạng thái `outline` nối tiếp chương cuối hiện có. */
export async function planChapters(seriesId: number, count: number) {
  const s = await getSeries(seriesId);
  const previous = await listChapters(seriesId);
  const { chapters: drafts } = await textProvider().generateJson({
    ...outlinePrompt(s, previous, count),
    schema: outlineSchema,
    temperature: 0.9,
  });

  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  await db()
    .insert(chapters)
    .values(drafts.map((d, i) => ({ seriesId, number: startAt + i, title: d.title, outline: d.outline })));
}

/** Viết nội dung + tóm tắt cho một chương. Chương đã duyệt thì không viết đè. */
export async function writeChapter(chapterId: number) {
  const chapter = await getChapter(chapterId);
  if (chapter.status === "approved") throw new Error("Chương đã duyệt — bỏ duyệt trước khi viết lại.");

  const s = await getSeries(chapter.seriesId);
  const previous = await db()
    .select()
    .from(chapters)
    .where(and(eq(chapters.seriesId, s.id), lt(chapters.number, chapter.number)))
    .orderBy(asc(chapters.number));

  const ai = textProvider();
  const content = await ai.generateText({
    ...chapterPrompt(s, previous, chapter),
    // Tiếng Việt ~2 token/từ, chừa thêm chỗ cho thinking token của model.
    maxOutputTokens: s.targetWords * 4,
    temperature: 0.9,
  });
  const summary = await ai.generateText({ ...summaryPrompt(chapter, content), temperature: 0.3 });

  await db()
    .update(chapters)
    .set({ content, summary, status: "draft", updatedAt: new Date() })
    .where(eq(chapters.id, chapterId));
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
