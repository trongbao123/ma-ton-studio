// Bù Short cho tập đã lên YouTube mà lúc dựng tập Short bị bỏ qua (hết quota giọng/ảnh, lỗi vẽ). Gọi từ daily.ts hoặc CLI "shorts".
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chapters, series, videos, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { loadSecrets } from "@/lib/secrets";
import { BACKFILL_PER_RUN, isYoutubeQuotaMessage, nextBackfillState, pickShortBackfill, shortPublishAt, type BackfillCandidate, type BackfillOutcome } from "@/lib/short-backfill";
import { heroRef } from "./hero";
import { accessToken, cleanTags, getYoutubeAuth, noAngle, YoutubeAuthError } from "@/lib/youtube";
import { renderShort } from "./episode";
import { pickMusic } from "./render";
import { ensureRelease, uploadAsset } from "./release";
import { uploadVideo } from "./youtube";

const shortDraftSchema = z.object({
  shortScript: z.string().describe("Lời đọc Short 15–20 giây (45–60 từ): hook cực mạnh câu đầu, kể khoảnh khắc KỊCH TÍNH nhất trong các chương, dừng ở cao trào, câu cuối mời xem tập full"),
  thumbnailText: z.string().describe("Chữ hook hiện trên Short, 2–3 từ IN HOA, cảm xúc mạnh"),
  characterLook: z.string().describe("English: ngoại hình nhân vật chính"),
});

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

/** Sinh shortScript/thumbnailText/characterLook từ tóm tắt các chương của tập (AI rẻ). */
async function draftShort(seriesRow: typeof series.$inferSelect, meta: VideoMeta, videoIds: number[]) {
  const rows = await db()
    .select({ number: chapters.number, title: chapters.title, summary: chapters.summary, content: chapters.content })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(inArray(videos.id, videoIds))
    .orderBy(asc(chapters.number));
  const body = rows.map((c) => `Chương ${c.number}: ${c.title}\n  Tóm tắt: ${clip(c.summary, 600)}\n  Đoạn cuối: ${clip(c.content.slice(-1200), 1200)}`).join("\n\n");
  return textProvider().generateJson({
    system: "Bạn là chuyên gia YouTube Shorts kênh truyện audio tiên hiệp Việt Nam, tối ưu giữ chân người xem.",
    prompt: `Viết kịch bản Short cho TẬP ${meta.compilation?.episodeNo ?? ""} (chương ${meta.compilation?.from}–${meta.compilation?.to}).\n\nTruyện: ${seriesRow.title}\nCốt truyện: ${seriesRow.premise}\nNhân vật/bối cảnh:\n${seriesRow.bible.slice(0, 2000)}\n\n${body}`,
    schema: shortDraftSchema,
    temperature: 0.8,
    tier: "cheap",
    task: "meta",
  });
}

async function saveMeta(id: number, meta: VideoMeta) {
  await db().update(videos).set({ meta }).where(eq(videos.id, id));
}

/** Làm + đăng Short cho một tập. Ném lỗi để backfillEpisodeShorts phân loại. */
async function backfillOne(v: typeof videos.$inferSelect): Promise<void> {
  let meta = v.meta!;
  const [row] = await db()
    .select({ s: series })
    .from(chapters)
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(chapters.id, v.chapterId));
  if (!row) throw new Error("Không tìm thấy bộ truyện của tập");

  if (!meta.shortScript || !meta.characterLook || !meta.thumbnailText) {
    console.log("  Thiếu kịch bản Short — sinh bằng AI");
    const d = await draftShort(row.s, meta, meta.compilation!.videoIds);
    meta = { ...meta, shortScript: meta.shortScript || d.shortScript, thumbnailText: meta.thumbnailText || d.thumbnailText, characterLook: meta.characterLook || d.characterLook };
    await saveMeta(v.id, meta);
  }

  const dir = path.resolve(`.render/short-${v.id}`);
  await mkdir(dir, { recursive: true });
  const hero = await heroRef(row.s, dir);
  const file = await renderShort({
    dir, voice: row.s.ttsVoice, script: meta.shortScript!, characterLook: hero.look, hook: meta.thumbnailText!, music: await pickMusic(v.id), heroRef: hero.file,
  });

  const auth = await getYoutubeAuth();
  if (!auth) throw new YoutubeAuthError("Chưa kết nối YouTube");
  const token = await accessToken(auth.refreshToken);
  const id = await uploadVideo(token, {
    file, title: noAngle(meta.shortTitle), description: noAngle(meta.shortDescription), tags: cleanTags(meta.tags),
    publishAt: shortPublishAt(v.publishAt, new Date()),
  });
  // Lưu id ngay sau upload: lỗi bước sau không làm upload trùng.
  await db().update(videos).set({ youtubeShortId: id }).where(eq(videos.id, v.id));
  console.log(`  Short: youtu.be/${id}`);

  const releaseId = await ensureRelease(v.id, false);
  await uploadAsset(v.id, releaseId, file).catch((e) => console.warn("⚠ Không lưu được short.mp4 vào release:", e instanceof Error ? e.message : e));
  if (process.env.GITHUB_ACTIONS) await rm(dir, { recursive: true, force: true });
}

function classify(e: unknown): BackfillOutcome {
  if (e instanceof QuotaExhaustedError) return { kind: "quota" };
  const message = e instanceof Error ? e.message : String(e);
  return isYoutubeQuotaMessage(message) ? { kind: "quota" } : { kind: "error", message };
}

/** Bù Short cho các tập thiếu (tối đa BACKFILL_PER_RUN mỗi lượt). Hết quota → để lượt sau; lỗi khác đếm lần, quá 3 lần thì bỏ cuộc. */
export async function backfillEpisodeShorts(): Promise<number> {
  await loadSecrets(true);
  const rows = await db()
    .select()
    .from(videos)
    .where(and(isNotNull(videos.youtubeVideoId), isNull(videos.youtubeShortId), sql`${videos.meta}->'compilation'->>'episode' = 'true'`));
  const todo = pickShortBackfill(rows as BackfillCandidate[], new Date(), BACKFILL_PER_RUN);
  if (!todo.length) return console.log("🎬 Không có tập nào cần bù Short."), 0;

  let made = 0;
  for (const c of todo) {
    const v = rows.find((r) => r.id === c.id)!;
    console.log(`🎬 Bù Short cho tập #${v.id} (${v.meta!.title})`);
    let outcome = { kind: "ok" } as BackfillOutcome;
    try {
      await backfillOne(v);
      made++;
    } catch (e) {
      outcome = classify(e);
      console.warn(`⚠ Bù Short #${v.id}: ${outcome.kind === "error" ? outcome.message : "hết quota — thử lại lượt sau"}`);
    }
    // Đọc lại meta mới nhất (backfillOne có thể đã lưu kịch bản) rồi ghi marker.
    const [fresh] = await db().select({ meta: videos.meta }).from(videos).where(eq(videos.id, v.id));
    const state = nextBackfillState(fresh?.meta?.shortBackfill, outcome);
    if (fresh?.meta) await saveMeta(v.id, { ...fresh.meta, shortBackfill: state });
    if (outcome.kind === "ok") await notify(`🎬 <b>Đã bù Short</b> cho ${escapeHtml(v.meta!.title)}\n👉 ${WEB_URL}/videos/${v.id}`);
    if (outcome.kind === "error" && state.gaveUp) await notify(`⚠️ Bỏ cuộc bù Short sau ${state.attempts} lần: ${escapeHtml(v.meta!.title)}\n${escapeHtml(outcome.message.slice(0, 300))}\n👉 ${WEB_URL}/videos/${v.id}`);
    if (outcome.kind === "quota") break; // hết quota thì các tập sau cũng hết
  }
  return made;
}
