"use server";

import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath, revalidateTag, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { SERIES_TAG, TRENDS_TAG } from "@/lib/cache-tags";
import { appSettings, chapters, series, videos } from "@/db/schema";
import { layoutKey, mergeLayout, pickSubPositions, type Orientation, type Pos } from "@/lib/flow/layout";
import { draftBible, planChapters, writeChapterStep, type WriteMode } from "@/lib/story/service";
import { dispatchPublish, dispatchRender, dispatchTrends, queueVideo } from "@/lib/story/videos";
import { isChannelKey, saveYoutubeAuth, updateYoutubeSnippet } from "@/lib/youtube";
import { syncFromYoutube } from "@/lib/youtube-stats";
import { isLifeStory } from "@/lib/story/life";
import { optimizeMeta, SEO_TARGET } from "@/lib/seo-optimize";
import { VOICES } from "@/lib/flow/voices";
import { availableProviders, canRun, loadRouting, providerFor } from "@/lib/ai";
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
    updateTag(SERIES_TAG);
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
    updateTag(SERIES_TAG);
    revalidatePath(`/series/${seriesId}`);
    return "Đã lưu story bible.";
  });
}

export async function planChaptersAction(seriesId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const count = Math.min(Math.max(Number(form.get("count")) || 10, 1), 30);
  return attempt(async () => {
    await planChapters(seriesId, count);
    updateTag(SERIES_TAG);
    revalidatePath(`/series/${seriesId}`);
    return `Đã lên dàn ý ${count} chương.`;
  });
}

export async function writeChapterAction(chapterId: number, mode: WriteMode) {
  try {
    const r = await writeChapterStep(chapterId, mode);
    if (mode === "finish") {
      updateTag(SERIES_TAG);
      revalidatePath("/", "layout");
    }
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
    updateTag(SERIES_TAG);
    revalidatePath("/", "layout");
    return "Đã lưu.";
  });
}

export async function setApprovedAction(chapterId: number, approved: boolean): Promise<ActionState> {
  return attempt(async () => {
    const [row] = await db().select({ content: chapters.content, factIssues: chapters.factIssues }).from(chapters).where(eq(chapters.id, chapterId));
    if (approved && !row?.content) throw new Error("Chương chưa có nội dung.");
    // Kênh lịch sử: kịch bản còn lỗi sự thật không được duyệt (duyệt = render).
    const blocked = approved && row ? (await import("@/lib/story/history")).approvalBlockedReason(row) : null;
    if (blocked) throw new Error(blocked);
    await db()
      .update(chapters)
      .set({ status: approved ? "approved" : row?.content ? "draft" : "outline", updatedAt: new Date() })
      .where(eq(chapters.id, chapterId));
    if (approved) await queueVideo(chapterId);
    updateTag(SERIES_TAG);
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

/** Quét lại xu hướng YouTube: báo GitHub Actions chạy (mất vài phút, trang tự có dữ liệu mới khi xong). */
export async function scanTrendsAction(): Promise<ActionState> {
  return attempt(async () => {
    if (!(await dispatchTrends())) throw new Error("Chưa cấu hình GH_TOKEN / GH_REPO nên không gọi được GitHub Actions.");
    revalidateTag(TRENDS_TAG, "max");
    revalidatePath("/trends");
    return "Đã xếp hàng quét — khoảng 2–3 phút nữa tải lại trang.";
  });
}

/** Lưu vị trí node màn flow — một bố cục chung cho mọi video. Không revalidate: client đã giữ vị trí. */
export async function saveFlowLayoutAction(positions: Record<string, Pos>, orientation: Orientation = "v"): Promise<ActionState> {
  return attempt(async () => {
    const o: Orientation = orientation === "h" ? "h" : "v";
    // Thẻ chính (đủ bộ mới nhận) + vị trí node con `sub:*` lưu chung một bản.
    const value = { ...mergeLayout(positions, o), ...pickSubPositions(positions) };
    await db()
      .insert(appSettings)
      .values({ key: layoutKey(o), value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return "Đã lưu bố cục.";
  });
}

export async function resetFlowLayoutAction(orientation: Orientation = "v"): Promise<ActionState> {
  return attempt(async () => {
    await db().delete(appSettings).where(eq(appSettings.key, layoutKey(orientation === "h" ? "h" : "v")));
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

/** Ngắt kênh (bind khoá kênh từ node YouTube; mặc định kênh gốc). */
export async function disconnectYoutubeAction(channel: string = "main"): Promise<ActionState> {
  return attempt(async () => {
    if (typeof channel !== "string" || !isChannelKey(channel)) throw new Error("Khoá kênh không hợp lệ.");
    await saveYoutubeAuth(null, channel);
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

/**
 * Magic fill trên màn flow: AI sửa tiêu đề / mô tả / tag / Short tới khi điểm SEO tổng ≥ 90 (tối đa 3 lượt).
 * Video đã lên YouTube thì cập nhật luôn trên YouTube.
 */
export async function optimizeSeoAction(videoId: number): Promise<ActionState> {
  return attempt(async () => {
    const [row] = await db()
      .select({ v: videos, c: chapters, s: series })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(eq(videos.id, videoId));
    if (!row?.v.meta) throw new Error("Video chưa có tiêu đề/mô tả để tối ưu.");
    // Bản trên YouTube là bản đúng (người dùng hay sửa tay): kéo về trước để Magic fill sửa tiếp từ đó, không ghi đè mất.
    if (await syncFromYoutube([row.v.youtubeVideoId, row.v.youtubeShortId].filter((x): x is string => Boolean(x)))) {
      const [fresh] = await db().select({ meta: videos.meta }).from(videos).where(eq(videos.id, videoId));
      if (fresh?.meta) row.v.meta = fresh.meta;
    }
    const { v, c, s } = row;
    const life = isLifeStory(s);
    const r = await optimizeMeta(v.meta!, { seriesTitle: s.title, chapterNumber: c.number, chapterTitle: c.title, summary: c.summary, life });
    if (r.score <= r.from) return `Đã thử ${r.rounds} lượt nhưng chưa tăng được điểm (đang ${r.from}). Thử lại hoặc đổi AI viết tiêu đề/mô tả.`;
    await db().update(videos).set({ meta: r.meta, updatedAt: new Date() }).where(eq(videos.id, videoId));
    const notes: string[] = [];
    if (v.youtubeVideoId) {
      try {
        await updateYoutubeSnippet(v.youtubeVideoId, r.meta, life);
        if (v.youtubeShortId) await updateYoutubeSnippet(v.youtubeShortId, { title: r.meta.shortTitle, description: r.meta.shortDescription, tags: r.meta.tags }, life);
        notes.push("đã cập nhật lên YouTube");
      } catch (e) {
        notes.push(`chưa cập nhật được YouTube: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
      }
    }
    revalidatePath("/videos", "layout");
    return `Điểm SEO ${r.from} → ${r.score}${r.score >= SEO_TARGET ? " ✓" : ""} sau ${r.rounds} lượt${notes.length ? ` — ${notes.join("; ")}` : ""}.`;
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
    if (!canRun(provider)) throw new Error("AI dùng gói chỉ chạy trong job GitHub Actions — đã lưu, sẽ dùng ở lần render sau.");
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

/** Tham số bind từ client không được mã hoá — chỉ nhận id nguyên dương (nó đi tiếp vào lệnh GitHub Actions). */
function assertPositiveId(id: unknown): asserts id is number {
  if (!Number.isInteger(id) || (id as number) <= 0) throw new Error("ID không hợp lệ.");
}

/** Kênh lịch sử: gửi lệnh viết kịch bản đề tài kế tiếp sang GitHub Actions (viết + soát mất 15–30 phút, không chạy trên Vercel). */
export async function writeHistoryScriptAction(seriesId: number): Promise<ActionState> {
  return attempt(async () => {
    assertPositiveId(seriesId);
    const { dispatchCommand } = await import("@/lib/story/videos");
    if (!(await dispatchCommand(`historyscript:${seriesId}`))) throw new Error("Chưa cấu hình GitHub (GH_TOKEN/GH_REPO) — không gọi được Actions.");
    return "Đã gửi lệnh viết kịch bản — chạy trên GitHub Actions (~15–30 phút), xong sẽ báo Telegram.";
  });
}

/** Kênh lịch sử: soát lại kịch bản "chờ sửa" (sau khi sửa tay) trên GitHub Actions; đạt thì gỡ cờ và chốt. */
export async function recheckFactsAction(chapterId: number): Promise<ActionState> {
  return attempt(async () => {
    assertPositiveId(chapterId);
    const { dispatchCommand } = await import("@/lib/story/videos");
    if (!(await dispatchCommand(`factcheck:${chapterId}`))) throw new Error("Chưa cấu hình GitHub (GH_TOKEN/GH_REPO) — không gọi được Actions.");
    return "Đã gửi lệnh soát lại — chạy trên GitHub Actions (vài phút), xong sẽ báo Telegram nếu còn lỗi.";
  });
}

/** Kênh lịch sử: chủ kênh thêm đề tài (tiêu đề + bài Wikipedia tiếng Anh); đề tài nhạy cảm bị từ chối. */
export async function addHistoryTopicAction(seriesId: number, _: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    assertPositiveId(seriesId);
    const { topicOutline, validateHistoryTopic } = await import("@/lib/story/history");
    const title = String(form.get("title") ?? "").trim();
    const wiki = String(form.get("wiki") ?? "").trim();
    const invalid = validateHistoryTopic(title, wiki);
    if (invalid) throw new Error(invalid);
    const [last] = await db().select({ number: chapters.number }).from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(desc(chapters.number)).limit(1);
    await db().insert(chapters).values({ seriesId, number: (last?.number ?? 0) + 1, title, outline: topicOutline({ title, wiki, angle: "" }) });
    updateTag(SERIES_TAG);
    revalidatePath("/lich-su");
    return `Đã thêm đề tài "${title}".`;
  });
}

/** Kết nối Page Facebook cho một kênh: user token ngắn hạn (Graph API Explorer) → token Page không hết hạn, lưu mã hoá. */
export async function connectFacebookAction(_: ActionState, form: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { exchangePageToken, saveFacebookAuth } = await import("@/lib/facebook");
    const channel = String(form.get("channel") ?? "").trim();
    const pageId = String(form.get("pageId") ?? "").trim();
    const userToken = String(form.get("userToken") ?? "").trim();
    if (!isChannelKey(channel)) throw new Error("Khoá kênh không hợp lệ.");
    if (!/^\d{5,}$/.test(pageId)) throw new Error("Page ID phải là dãy số.");
    if (userToken.length < 20) throw new Error("Token quá ngắn — copy lại nguyên token ở Graph API Explorer.");
    await loadSecrets(true);
    const auth = await exchangePageToken(userToken, pageId);
    await saveFacebookAuth(auth, channel);
    revalidatePath("/settings/ai");
    return `Đã kết nối Page “${auth.pageName}” (${auth.pageId}) cho kênh ${channel}.`;
  });
}

/** Bộ chọn kênh ở thanh bên: chỉ đổi cookie lọc hiển thị (pipeline vẫn chạy mọi kênh). */
export async function setViewChannelAction(channel: string): Promise<void> {
  const { cookies } = await import("next/headers");
  const { ALL_CHANNELS, CHANNEL_COOKIE } = await import("@/lib/channel-filter");
  const value = channel === ALL_CHANNELS || isChannelKey(channel) ? channel : ALL_CHANNELS;
  (await cookies()).set(CHANNEL_COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 365 * 86400, path: "/" });
  revalidatePath("/", "layout");
}
