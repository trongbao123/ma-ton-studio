"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { appSettings, chapters, series, videos } from "@/db/schema";
import { LAYOUT_KEY, mergeLayout, type Pos } from "@/lib/flow/layout";
import { draftBible, planChapters, writeChapterStep, type WriteMode } from "@/lib/story/service";
import { dispatchPublish, dispatchRender, queueVideo } from "@/lib/story/videos";
import { saveYoutubeAuth } from "@/lib/youtube";
import { VOICES } from "@/lib/flow/voices";
import { availableProviders, loadRouting, providerFor } from "@/lib/ai";
import { loadSecrets, saveSecret } from "@/lib/secrets";
import { IMAGE_ROUTING_KEY, normalizeImageRouting, normalizeRouting, promote, ROUTING_KEY, type AiTask, type ImageRoute, type ProviderId, type Route, type Routing } from "@/lib/ai/routing";

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
        autopilot: form.get("autopilot") === "on",
        autoApprove: form.get("autoApprove") === "on",
        chaptersPerDay: Math.min(Math.max(Number(form.get("chaptersPerDay")) || 2, 1), 10),
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

export async function writeChapterAction(chapterId: number, mode: WriteMode) {
  try {
    const r = await writeChapterStep(chapterId, mode);
    if (mode === "finish") revalidatePath("/", "layout");
    return r;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
    if (approved) await queueVideo(chapterId);
    revalidatePath("/", "layout");
    return approved ? "Đã duyệt — đang render video." : "Đã bỏ duyệt.";
  });
}

export async function rerenderAction(videoId: number): Promise<ActionState> {
  return attempt(async () => {
    const [v] = await db().select({ status: videos.status, uploadStatus: videos.uploadStatus }).from(videos).where(eq(videos.id, videoId));
    if (!v) throw new Error("Không có video.");
    if (v.status === "published") throw new Error("Video đã đăng — không render lại.");
    if (v.uploadStatus === "uploading") throw new Error("Đang upload YouTube — chờ xong rồi hãy render lại.");
    await db().update(videos).set({ status: "queued", error: null, updatedAt: new Date() }).where(eq(videos.id, videoId));
    await dispatchRender(videoId);
    revalidatePath("/videos", "layout");
    return "Đã xếp hàng render lại.";
  });
}

/** Lưu vị trí node màn flow — một bố cục chung cho mọi video. Không revalidate: client đã giữ vị trí. */
export async function saveFlowLayoutAction(positions: Record<string, Pos>): Promise<ActionState> {
  return attempt(async () => {
    const value = mergeLayout(positions);
    await db()
      .insert(appSettings)
      .values({ key: LAYOUT_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return "Đã lưu bố cục.";
  });
}

export async function resetFlowLayoutAction(): Promise<ActionState> {
  return attempt(async () => {
    await db().delete(appSettings).where(eq(appSettings.key, LAYOUT_KEY));
    revalidatePath("/videos", "layout");
    return "Đã sắp xếp lại.";
  });
}

export async function markPublishedAction(videoId: number, _: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    await db()
      .update(videos)
      .set({ status: "published", youtubeUrl: String(form.get("youtubeUrl") ?? "") || null, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    revalidatePath("/videos", "layout");
    return "Đã đánh dấu đã đăng.";
  });
}

/** Chỉnh nhanh trên node màn flow — lưu theo bộ truyện, áp dụng từ lần render sau. */
export async function updateFlowSettingsAction(
  seriesId: number,
  patch: { ttsVoice?: string; makeShort?: boolean; autoPublish?: boolean },
): Promise<ActionState> {
  return attempt(async () => {
    if (patch.ttsVoice !== undefined && !VOICES.some((v) => v.id === patch.ttsVoice)) throw new Error("Giọng không hợp lệ.");
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(set).length) return "Không có gì thay đổi.";
    await db().update(series).set(set).where(eq(series.id, seriesId));
    revalidatePath("/videos", "layout");
    return "Đã lưu — áp dụng từ lần render sau.";
  });
}

/** Đăng (lại) YouTube cho video đã render: chạy workflow publish.yml, không render lại. */
export async function retryPublishAction(videoId: number): Promise<ActionState> {
  return attempt(async () => {
    // Giữ chỗ nguyên tử: bấm 2 lần hay đang đăng dở thì không chạy thêm job (tránh upload trùng).
    const claimed = await db()
      .update(videos)
      .set({ uploadStatus: "uploading", uploadError: null })
      .where(and(eq(videos.id, videoId), eq(videos.status, "ready"), isNull(videos.youtubeVideoId), inArray(videos.uploadStatus, ["none", "failed"])))
      .returning({ id: videos.id });
    if (!claimed.length) throw new Error("Không đăng được: video chưa render xong, đang đăng, hoặc đã có trên YouTube.");
    const fail = (msg: string) => db().update(videos).set({ uploadStatus: "failed", uploadError: msg }).where(eq(videos.id, videoId));
    try {
      if (!(await dispatchPublish(videoId))) {
        await fail("Chưa cấu hình GH_TOKEN/GH_REPO trên Vercel — không gọi được GitHub Actions.");
        throw new Error("Chưa cấu hình GH_TOKEN/GH_REPO trên Vercel.");
      }
    } catch (e) {
      await fail(e instanceof Error ? e.message : String(e));
      throw e;
    }
    revalidatePath("/videos", "layout");
    return "Đang đăng lên YouTube…";
  });
}

export async function disconnectYoutubeAction(): Promise<ActionState> {
  return attempt(async () => {
    await saveYoutubeAuth(null);
    revalidatePath("/videos", "layout");
    return "Đã ngắt kết nối YouTube.";
  });
}

/** Lưu thứ tự AI cho từng việc (trang Cài đặt AI). Job đang chạy nhận cấu hình mới trong ≤ 60 giây. */
export async function saveAiRoutingAction(routing: Routing, images: ImageRoute[]): Promise<ActionState> {
  return attempt(async () => {
    for (const [key, value] of [
      [ROUTING_KEY, normalizeRouting(routing)],
      [IMAGE_ROUTING_KEY, normalizeImageRouting(images)],
    ] as const) {
      await db()
        .insert(appSettings)
        .values({ key, value })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    }
    revalidatePath("/settings/ai");
    return "Đã lưu cài đặt AI.";
  });
}

/** Đổi nhanh AI cho một việc ngay trên màn flow: đưa AI đã chọn lên đầu, các AI khác giữ làm dự phòng. */
export async function setTaskAiAction(task: AiTask, route: Route): Promise<ActionState> {
  return attempt(async () => {
    const value = normalizeRouting(promote(await loadRouting(true), task, route));
    await db()
      .insert(appSettings)
      .values({ key: ROUTING_KEY, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    revalidatePath("/videos", "layout");
    revalidatePath("/settings/ai");
    return "Đã đổi — áp dụng từ lần render sau.";
  });
}

/** Gọi thử 1 AI với câu hỏi ngắn để kiểm tra key và model. */
export async function testAiAction(provider: ProviderId, model: string): Promise<ActionState> {
  return attempt(async () => {
    await loadSecrets();
    if (!availableProviders().includes(provider)) throw new Error("Chưa có key cho AI này — dán key ở mục Kết nối.");
    const started = Date.now();
    const p = providerFor({ provider, model });
    const text = await p.generateText({
      system: "Trả lời thật ngắn bằng tiếng Việt.",
      prompt: "Chào một câu theo giọng ma tôn trong truyện tiên hiệp.",
      maxOutputTokens: 2000,
      tier: "cheap",
    });
    return `${p.lastModel ?? model} · ${((Date.now() - started) / 1000).toFixed(1)}s — “${text.slice(0, 120)}”`;
  });
}

/** Dán (hoặc xoá khi để trống) key trên web — Vercel và GitHub Actions cùng đọc từ DB, không cần deploy lại. */
export async function saveSecretAction(env: string, _: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const value = String(form.get("value") ?? "").trim();
    if (form.get("remove") === "1") {
      await saveSecret(env, null);
      revalidatePath("/settings/ai");
      return "Đã xoá key trên web.";
    }
    if (value.length < 8) throw new Error("Key quá ngắn — dán lại nguyên key.");
    await saveSecret(env, value);
    revalidatePath("/settings/ai");
    return "Đã lưu — dùng được ngay ở web và job render.";
  });
}
