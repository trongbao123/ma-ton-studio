"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { chapters, series } from "@/db/schema";
import { draftBible, planChapters, writeChapter } from "@/lib/story/service";

export type ActionState = { error?: string; ok?: string };

/** Bọc lỗi thành state để form hiện thông báo thay vì trang lỗi trắng. */
async function attempt(run: () => Promise<string | void>): Promise<ActionState> {
  try {
    const ok = await run();
    return { ok: ok ?? "Xong." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function createSeriesAction(_: ActionState, form: FormData): Promise<ActionState> {
  const idea = String(form.get("idea") ?? "").trim();
  const genre = String(form.get("genre") ?? "").trim() || "tiên hiệp";
  const targetWords = Number(form.get("targetWords")) || 4000;
  if (idea.length < 10) return { error: "Ý tưởng quá ngắn — viết ít nhất một câu." };

  let id = 0;
  const state = await attempt(async () => {
    const draft = await draftBible(idea, genre);
    const [row] = await db()
      .insert(series)
      .values({ ...draft, genre, targetWords })
      .returning({ id: series.id });
    id = row.id;
  });
  if (state.error) return state;
  redirect(`/series/${id}`);
}

export async function updateSeriesAction(seriesId: number, _: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    await db()
      .update(series)
      .set({
        title: String(form.get("title")),
        premise: String(form.get("premise")),
        bible: String(form.get("bible")),
        style: String(form.get("style")),
        targetWords: Number(form.get("targetWords")) || 4000,
      })
      .where(eq(series.id, seriesId));
    revalidatePath(`/series/${seriesId}`);
    return "Đã lưu story bible.";
  });
}

export async function planChaptersAction(seriesId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const count = Math.min(Math.max(Number(form.get("count")) || 10, 1), 30);
  return attempt(async () => {
    await planChapters(seriesId, count);
    revalidatePath(`/series/${seriesId}`);
    return `Đã lên dàn ý ${count} chương.`;
  });
}

export async function writeChapterAction(chapterId: number): Promise<ActionState> {
  return attempt(async () => {
    await writeChapter(chapterId);
    revalidatePath("/", "layout");
    return "AI đã viết xong — đọc và duyệt.";
  });
}

export async function saveChapterAction(chapterId: number, _: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const [row] = await db().select({ status: chapters.status }).from(chapters).where(eq(chapters.id, chapterId));
    if (row?.status === "approved") throw new Error("Chương đã duyệt — bỏ duyệt trước khi sửa.");
    await db()
      .update(chapters)
      .set({
        title: String(form.get("title")),
        outline: String(form.get("outline")),
        content: String(form.get("content")),
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, chapterId));
    revalidatePath("/", "layout");
    return "Đã lưu.";
  });
}

export async function setApprovedAction(chapterId: number, approved: boolean): Promise<ActionState> {
  return attempt(async () => {
    const [row] = await db().select({ content: chapters.content }).from(chapters).where(eq(chapters.id, chapterId));
    if (approved && !row?.content) throw new Error("Chương chưa có nội dung.");
    await db()
      .update(chapters)
      .set({ status: approved ? "approved" : row?.content ? "draft" : "outline", updatedAt: new Date() })
      .where(eq(chapters.id, chapterId));
    revalidatePath("/", "layout");
    return approved ? "Đã duyệt." : "Đã bỏ duyệt.";
  });
}
