// Short cắt cảnh: mỗi ngày tối đa 2 Short dựng từ đoạn kịch tính nhất của các chương đã viết (cộng 1 Short của tập = 3 Short/ngày).
// Gọi từ daily.ts (sau khi đã ưu tiên render chương cho tập kế tiếp) hoặc CLI "clips[:N]".
import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { aiUsage, chapters, series, videos, type Series, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { quotaDay } from "@/lib/ai/usage";
import { YT_USAGE_MODEL } from "@/lib/limits";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { loadSecrets } from "@/lib/secrets";
import { isYoutubeQuotaMessage } from "@/lib/short-backfill";
import { accessToken, channelUrlOf, cleanTags, getYoutubeAuth, noAngle, YoutubeAuthError } from "@/lib/youtube";
import { buildClipDescription, canUploadClip, clipsToMake, clipTags, ensureShortsTag, fullEpisodeUrl, pickClipSlot, pickClipSources, pickClipTitle, CLIP_TITLE_ROUNDS, CLIP_TITLE_TARGET, type ClipSource } from "./clip-plan";
import { seriesRows, withStaleAsFailed } from "./compile";
import { vnDay } from "./episode-plan";
import { renderShort } from "./episode";
import { duration } from "./ffmpeg";
import { addToShortsPlaylist, playlistUrl, seriesPlaylist } from "./playlist";
import { ensureRelease, uploadAsset } from "./release";
import { musicCredit, pickMusic } from "./render";
import { uploadVideo } from "./youtube";
import { genreSeeds, keywordResearch, pickBestTitle, scoreTitles, type ScoredTitle } from "./vidiq";

/** Chương lỗi quá ngần này lần (không phải hết quota) thì bỏ qua, không thử lại mỗi lượt. */
const MAX_CLIP_FAILS = 3;
const FAIL_DAY = "forever";
const failMarker = (chapterId: number) => `_clipfail_${chapterId}`;
/** Bản ghi Short dở dang (chết giữa lúc upload) quá ngần này phút thì dọn. */
const ORPHAN_MINUTES = 60;
/** Nội dung chương đưa AI: đầu + cuối (cao trào thường ở nửa sau). */
const CONTENT_HEAD = 4000;
const CONTENT_TAIL = 12000;

const clipDraftSchema = z.object({
  shortScript: z.string().describe("Lời đọc Short 15–20 giây (45–60 từ). Câu ĐẦU là hook cực mạnh (≤ 8 từ, đọc dưới 2 giây). Kể đúng diễn biến của chương, dừng ở cao trào, câu cuối mời nghe tập full. Không thêm chi tiết không có trong chương"),
  hook: z.string().describe("Chữ hook hiện to trên Short, 2–4 từ IN HOA, cảm xúc mạnh"),
  titleOptions: z.array(z.string()).min(3).describe("3 tiêu đề YouTube khác nhau, mỗi cái ≤ 50 ký tự (chưa gồm #shorts): hook cảm xúc + 1 từ khóa người ta tìm thật (truyện tu tiên / truyện audio). Không spoil kết"),
  description: z.string().describe("2–3 câu mô tả Short bằng tiếng Việt, có từ khóa tìm kiếm (truyện tu tiên, truyện audio), tò mò, không spoil kết"),
  characterLook: z.string().describe("English: ngoại hình nhân vật chính trong đoạn này"),
});
type ClipDraft = z.infer<typeof clipDraftSchema>;

const clip = (t: string, head: number, tail: number) => (t.length > head + tail ? `${t.slice(0, head)}\n[…lược…]\n${t.slice(-tail)}` : t);

/** AI rẻ (task "meta") chọn đoạn kịch tính nhất của chương và viết kịch bản + tiêu đề + mô tả. */
async function draftClip(s: Series, ch: { number: number; title: string; summary: string; content: string }, keywords: string[]): Promise<ClipDraft> {
  return textProvider().generateJson({
    system: "Bạn là chuyên gia YouTube Shorts kênh truyện audio tiên hiệp Việt Nam, tối ưu giữ chân người xem và SEO tìm kiếm.",
    prompt:
      `Chọn ĐOẠN KỊCH TÍNH NHẤT của chương ${ch.number} và viết kịch bản Short từ đoạn đó.\n\nTruyện: ${s.title}\nCốt truyện: ${s.premise}\nNhân vật/bối cảnh:\n${s.bible.slice(0, 1500)}\n\n` +
      `Từ khóa người xem tìm thật: ${keywords.slice(0, 8).join(", ") || "truyện tu tiên, truyện audio"}\n\n` +
      `Chương ${ch.number}: ${ch.title}\nTóm tắt: ${ch.summary.slice(0, 600)}\nNội dung:\n${clip(ch.content, CONTENT_HEAD, CONTENT_TAIL)}`,
    schema: clipDraftSchema,
    temperature: 0.8,
    tier: "cheap",
    task: "meta",
  });
}

/** Tiêu đề: AI 3 phương án + vidIQ gợi ý (type "short"), chấm hết bằng vidiq_score_title type "short", lấy điểm cao nhất. */
async function chooseClipTitle(d: ClipDraft, keywords: string[]): Promise<{ best: ScoredTitle; all: ScoredTitle[] }> {
  const options = d.titleOptions.map((t) => ensureShortsTag(t));
  const res = await pickBestTitle(options, d.description, CLIP_TITLE_TARGET, CLIP_TITLE_ROUNDS, "short").catch(() => null);
  const all = res?.all ?? options.map((title) => ({ title, score: null }));
  const best = pickClipTitle(all);
  // Tiêu đề cuối bị ghép từ khóa / #shorts → khác bản đã chấm: chấm lại để web hiện điểm thật (~5 credit).
  if (best.score == null) {
    const [score] = (await scoreTitles([best.title], "short").catch(() => null)) ?? [null];
    if (score != null) return { best: { ...best, score }, all: [{ title: best.title, score }, ...all] };
  }
  return { best, all };
}

/** Unit YouTube đã dùng trong ngày quota hiện tại (Pacific). */
async function usedUnitsToday(): Promise<number> {
  const [r] = await db().select({ calls: aiUsage.calls }).from(aiUsage).where(and(eq(aiUsage.day, quotaDay()), eq(aiUsage.model, YT_USAGE_MODEL)));
  return r?.calls ?? 0;
}

const clipRows = () =>
  db().select({ id: videos.id, meta: videos.meta, publishAt: videos.publishAt, createdAt: videos.createdAt, shortId: videos.youtubeShortId }).from(videos).where(sql`${videos.meta}->'shortClip' is not null`);

/** Dọn bản ghi Short chết giữa chừng (có row mà chưa có id YouTube) để chương được thử lại. */
async function sweepOrphans() {
  const cutoff = new Date(Date.now() - ORPHAN_MINUTES * 60_000);
  await db().delete(videos).where(and(sql`${videos.meta}->'shortClip' is not null`, sql`${videos.youtubeShortId} is null`, lt(videos.updatedAt, cutoff)));
}

/** Chương mà Short cắt cảnh đã từng lỗi quá MAX_CLIP_FAILS lần. */
async function gaveUpChapters(): Promise<number[]> {
  const rows = await db().select({ model: aiUsage.model, calls: aiUsage.calls }).from(aiUsage).where(and(eq(aiUsage.day, FAIL_DAY), sql`${aiUsage.calls} >= ${MAX_CLIP_FAILS}`));
  return rows.map((r) => Number(r.model.replace("_clipfail_", ""))).filter(Number.isFinite);
}

async function recordFail(chapterId: number) {
  await db().insert(aiUsage).values({ day: FAIL_DAY, model: failMarker(chapterId), calls: 1 }).onConflictDoUpdate({ target: [aiUsage.day, aiUsage.model], set: { calls: sql`${aiUsage.calls} + 1` } });
}

/** Chương của các tập đã dựng xong (đã đăng hoặc chờ đăng) của một bộ truyện, kèm tập chứa nó. */
async function sourcesOf(seriesId: number, now: Date): Promise<{ sources: ClipSource[]; keywords: string[]; characterLook: string | null }> {
  const rows = withStaleAsFailed(await seriesRows(seriesId), now);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const episodes = rows.filter((r) => r.meta?.compilation?.episode && (r.status === "ready" || r.status === "published")).sort((a, b) => b.id - a.id);
  const sources = episodes.flatMap((ep) =>
    ep.meta!.compilation!.videoIds.flatMap((vid) => {
      const ch = byId.get(vid);
      return ch ? [{ chapterId: ch.chapterId, number: ch.number, episodeVideoId: ep.id, episodeYoutubeId: ep.youtubeVideoId, episodePublishAt: ep.publishAt }] : [];
    }),
  );
  const latest = episodes[0]?.meta;
  return { sources, keywords: episodes.find((e) => e.meta?.seo?.keywords?.length)?.meta?.seo?.keywords ?? [], characterLook: latest?.characterLook ?? null };
}

type Ctx = { s: Series; src: ClipSource; keywords: string[]; characterLook: string | null; slot: Date };

/** Làm + đăng một Short cắt cảnh. Ném lỗi để makeSceneClips phân loại. Trả id row mới. */
async function makeOne(c: Ctx): Promise<number> {
  const [ch] = await db().select({ number: chapters.number, title: chapters.title, summary: chapters.summary, content: chapters.content }).from(chapters).where(eq(chapters.id, c.src.chapterId));
  if (!ch?.content.trim()) throw new Error(`Chương #${c.src.chapterId} chưa có nội dung`);
  const draft = await draftClip(c.s, ch, c.keywords);
  const { best, all } = await chooseClipTitle(draft, c.keywords);
  console.log(`  Tiêu đề (${best.score ?? "?"}): ${best.title}`);

  const dir = path.resolve(`.render/clip-${c.src.chapterId}`);
  const music = await pickMusic(c.src.chapterId);
  const file = await renderShort({ dir, voice: c.s.ttsVoice, script: draft.shortScript, characterLook: c.characterLook ?? draft.characterLook, hook: draft.hook, music });

  const own = await seriesPlaylist(c.s.id);
  const listUrl = own ? playlistUrl(own) : await channelUrlOf(c.s.channel);
  const description = buildClipDescription({
    body: draft.description,
    fullUrl: fullEpisodeUrl({ episodeYoutubeId: c.src.episodeYoutubeId, episodePublishAt: c.src.episodePublishAt, clipPublishAt: c.slot, playlistUrl: listUrl }),
    playlistUrl: listUrl,
    seriesTitle: c.s.title,
    tail: music ? musicCredit(music) : "",
    channelUrl: await channelUrlOf(c.s.channel),
  });
  const tags = clipTags(c.keywords, c.s.title);
  const meta: VideoMeta = {
    title: best.title, description, tags, shortTitle: best.title, shortDescription: description,
    shortScript: draft.shortScript, thumbnailText: draft.hook, characterLook: c.characterLook ?? draft.characterLook,
    seo: { titleScore: best.score, titleOptions: all, keywords: c.keywords },
    shortClip: { sourceChapterId: c.src.chapterId, scoreTitle: best.score, episodeVideoId: c.src.episodeVideoId },
  };

  const auth = await getYoutubeAuth(c.s.channel);
  if (!auth) throw new YoutubeAuthError(`Chưa kết nối YouTube (kênh ${c.s.channel})`);
  if (!canUploadClip(await usedUnitsToday())) throw new Error("quotaExceeded: không đủ unit YouTube hôm nay cho Short cắt cảnh");
  const token = await accessToken(auth.refreshToken);

  // Row có ngay trước upload (status published để không lọt vào "chương lẻ" của kho tập); lỗi upload thì xoá, chết giữa chừng thì sweepOrphans dọn.
  const [row] = await db()
    .insert(videos)
    .values({ chapterId: c.src.chapterId, status: "published", uploadStatus: "uploading", meta, publishAt: c.slot, durationSec: Math.round(await duration(file)) })
    .returning({ id: videos.id });
  try {
    const id = await uploadVideo(token, { file, title: noAngle(best.title), description: noAngle(description), tags: cleanTags(tags), publishAt: c.slot });
    await db().update(videos).set({ youtubeShortId: id, uploadStatus: "scheduled", updatedAt: new Date() }).where(eq(videos.id, row.id));
    console.log(`  Short cắt cảnh: youtu.be/${id} lúc ${c.slot.toISOString()}`);
    await addToShortsPlaylist(c.s.id, id).catch((e) => console.warn("  ⚠ Không thêm được vào playlist Short:", e instanceof Error ? e.message : e));
  } catch (e) {
    await db().delete(videos).where(and(eq(videos.id, row.id), sql`${videos.youtubeShortId} is null`));
    throw e;
  }
  const releaseId = await ensureRelease(row.id, false);
  await uploadAsset(row.id, releaseId, file).catch((e) => console.warn("⚠ Không lưu được short.mp4 vào release:", e instanceof Error ? e.message : e));
  if (process.env.GITHUB_ACTIONS) await rm(dir, { recursive: true, force: true });
  return row.id;
}

const isQuota = (e: unknown) => e instanceof QuotaExhaustedError || isYoutubeQuotaMessage(e instanceof Error ? e.message : String(e));

export type ClipOptions = {
  /** Số Short tối đa lượt này (mặc định CLIPS_PER_RUN). */
  max?: number;
  /** true (daily): nhường việc render chương cho tập kế tiếp trước, còn chương chờ render thì không làm Short. */
  afterRenders?: boolean;
  /** true (CLI chạy tay): bỏ trần "tối đa 2 Short/ngày", vẫn giữ trần unit YouTube. */
  ignoreDailyCap?: boolean;
};

/** Làm các Short cắt cảnh còn thiếu hôm nay. Hết quota giọng/ảnh/unit thì dừng, lượt sau làm tiếp. Trả số Short đã đăng. */
export async function makeSceneClips(opt: ClipOptions = {}): Promise<number> {
  await loadSecrets(true);
  const now = new Date();
  if (opt.afterRenders) {
    const [r] = await db().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(videos).where(and(inArray(videos.status, ["queued", "rendering"]), sql`${videos.meta}->'compilation' is null`));
    if (r.n > 0) return console.log(`✂ Còn ${r.n} video chương chờ render — ưu tiên tập kế tiếp, chưa làm Short cắt cảnh`), 0;
  }
  await sweepOrphans();
  const existing = await clipRows();
  const createdToday = existing.filter((r) => vnDay(r.createdAt) === vnDay(now)).length;
  let want = clipsToMake({ createdToday, usedUnits: await usedUnitsToday(), perRun: opt.max, perDay: opt.ignoreDailyCap ? Number.POSITIVE_INFINITY : undefined });
  if (want <= 0) return console.log(`✂ Short cắt cảnh: đã đủ hôm nay (${createdToday}) hoặc hết unit YouTube — để lượt sau`), 0;

  const usedChapters = [...existing.map((r) => r.meta!.shortClip!.sourceChapterId), ...(await gaveUpChapters())];
  const taken = existing.flatMap((r) => (r.publishAt ? [r.publishAt] : []));
  let made = 0;
  for (const s of await db().select().from(series).where(and(eq(series.makeShort, true), sql`${series.episodeChapters} > 0`))) {
    if (want <= 0) break;
    const { sources, keywords: known, characterLook } = await sourcesOf(s.id, now);
    const picked = pickClipSources(sources, usedChapters, want);
    if (!picked.length) {
      console.log(`✂ ${s.title}: chưa có chương nào để cắt Short`);
      continue;
    }
    const keywords = known.length ? known : ((await keywordResearch(genreSeeds(s.genre)))?.keywords.map((k) => k.keyword) ?? []);
    for (const src of picked) {
      const slot = pickClipSlot(taken, now);
      console.log(`✂ Short cắt cảnh: ${s.title} chương ${src.number} → ${slot.toISOString()}`);
      try {
        const id = await makeOne({ s, src, keywords, characterLook, slot });
        taken.push(slot);
        usedChapters.push(src.chapterId);
        made++;
        want--;
        await notify(`✂️ <b>Short cắt cảnh</b> ${escapeHtml(s.title)} — chương ${src.number}\n👉 ${WEB_URL}/videos/${id}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isQuota(e)) return console.warn(`⏸ Short cắt cảnh dừng (hết quota): ${msg.slice(0, 200)}`), made;
        console.warn(`⚠ Short cắt cảnh chương ${src.number} lỗi: ${msg}`);
        await recordFail(src.chapterId).catch(() => {});
      }
    }
  }
  return made;
}
