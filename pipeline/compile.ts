// Bản gộp: ghép nhiều video chương ĐÃ render của một bộ truyện thành video dài 1–2 giờ (tăng watch time).
// Không tốn quota giọng/ảnh của chương — chỉ có 1 thumbnail mới + meta AI. Chạy: render.yml với video_id = "compile:<seriesId>".
import { execFile } from "node:child_process";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chapters, series, videos, type Series, type VideoMeta } from "@/db/schema";
import { QuotaExhaustedError, textProvider } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { loadSecrets } from "@/lib/secrets";
import { AI_NOTE, optimizeMeta } from "@/lib/seo-optimize";
import { buildChapterMarks, collectMusicCredits, COMPILE_SIZE, compileLabel, nextCompileSlot, pickBatch, type CompileCandidate } from "./compile-plan";
import { duration, ffmpeg, streamSignature } from "./ffmpeg";
import { thumbnail } from "./render";
import { buildEpisodeContent, makeOutro, type ThumbVariant } from "./episode";
import { episodeBacklog } from "./episode-plan";
import { nextPublishSlot } from "./schedule";
import { ensureRelease, uploadAsset } from "./release";
import { judgeQc, measureQc, QcFailedError } from "./qc";
import { autoPublishEligible, publishToYoutube } from "./youtube";
import { chooseTitle, closeVidiq, genreSeeds, keywordResearch, scoreTitles } from "./vidiq";
import { HOOK_TITLE_RULE, NO_NAME_RULE, THUMB_TEXT_RULE } from "@/lib/meta-rules";

const run = promisify(execFile);

/** Bản gộp "đang làm" mà quá ngần này giờ không cập nhật = job đã chết (render.yml tối đa 3 giờ). */
const STALE_HOURS = 4;
/** Bản gộp lỗi thì chờ ngần này giờ mới tự gộp lại (tránh lặp vô hạn mỗi 3 tiếng). */
const RETRY_AFTER_HOURS = 24;
/** Tập ngày lỗi thì thử lại sau ngần này giờ (lượt daily kế tiếp) — không chờ cả ngày vì còn lịch 15h. */
const EPISODE_RETRY_AFTER_HOURS = 5;

export const metaSchema = z.object({
  title: z.string().describe(`Tiêu đề YouTube 40–75 ký tự về khoảnh khắc gay cấn nhất các chương gộp; ${HOOK_TITLE_RULE}`),
  titleAlternatives: z.array(z.string()).describe("2 phương án tiêu đề giật tít khác, góc tò mò khác nhau, cùng khuôn"),
  description: z.string().describe("Mô tả 220–300 từ, 3–4 đoạn (KHÔNG kèm mục lục chương, hệ thống tự thêm): câu đầu chứa tên truyện; giới thiệu hấp dẫn các chương gộp, không spoil kết; nhắc tên truyện ≥ 2 lần, lồng ≥ 1/3 số tag; kêu gọi đăng ký/like/bật chuông; dòng cuối 3–5 hashtag"),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt CÓ DẤU viết y như người xem gõ tìm (vd 'truyện tu tiên', KHÔNG viết 'truyen tu tien'); ít nhất 5 tag lấy nguyên văn từ danh sách từ khóa vidIQ, tổng 300–480 ký tự; tag đầu là từ khóa tìm kiếm điểm cao nhất, có tên truyện; trộn tag ngắn và dài; không trùng"),
  thumbnailText: z.string().describe(`Chữ trên thumbnail: ${THUMB_TEXT_RULE}; ${NO_NAME_RULE}`),
  thumbnailPrompt: z.string().describe("English image prompt for a YouTube thumbnail: extreme close-up of the main character's face and upper body at a dramatic moment, intense emotion, glowing eyes or energy, one focal point on the LEFT half, darker simpler RIGHT 40% for big text, high contrast, saturated colors"),
  characterLook: z.string().describe("English: mô tả ngoại hình nhân vật chính"),
});

export type Row = {
  id: number;
  publishAt: Date | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  hasLong: boolean;
  status: (typeof videos.$inferSelect)["status"];
  assets: Record<string, number>;
  meta: VideoMeta | null;
  updatedAt: Date;
  chapterId: number;
  number: number;
  title: string;
  summary: string;
};

export async function seriesRows(seriesId: number): Promise<Row[]> {
  const rows = await db()
    .select({
      id: videos.id, status: videos.status, assets: videos.assets, meta: videos.meta, updatedAt: videos.updatedAt,
      publishAt: videos.publishAt, youtubeVideoId: videos.youtubeVideoId, youtubeUrl: videos.youtubeUrl,
      chapterId: chapters.id, number: chapters.number, title: chapters.title, summary: chapters.summary,
    })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(eq(chapters.seriesId, seriesId));
  return rows.map((r) => ({ ...r, hasLong: Boolean(r.assets["long.mp4"]) }));
}

/** Bản gộp/tập "đang dựng" mà quá STALE_HOURS không cập nhật = job đã chết → coi như lỗi để chương được ghép lại. */
export function withStaleAsFailed(rows: Row[], now = new Date()): Row[] {
  return rows.map((r) =>
    r.meta?.compilation && (r.status === "rendering" || r.status === "queued") && now.getTime() - r.updatedAt.getTime() >= STALE_HOURS * 3600_000
      ? { ...r, status: "failed" as const }
      : r,
  );
}

/** Trạng thái gộp của một bộ truyện: có đang làm / vừa lỗi không, và 5 chương kế tiếp sẵn sàng gộp (nếu có). */
export async function compileState(s: Series, now = new Date()) {
  const seriesId = s.id;
  const episode = s.episodeChapters > 0;
  const rows = withStaleAsFailed(await seriesRows(seriesId), now);
  const fresh = (r: Row) => now.getTime() - r.updatedAt.getTime() < STALE_HOURS * 3600_000;
  const compiles = rows.filter((r) => r.meta?.compilation);
  const active = compiles.some((r) => (r.status === "rendering" || r.status === "queued") && fresh(r));
  const recentFailed = compiles.some((r) => r.status === "failed" && now.getTime() - r.updatedAt.getTime() < (episode ? EPISODE_RETRY_AFTER_HOURS : RETRY_AFTER_HOURS) * 3600_000);
  // Bản gộp lỗi / job chết thì các chương của nó được gộp lại.
  const used = new Set(
    compiles
      .filter((r) => r.status === "ready" || r.status === "published" || ((r.status === "rendering" || r.status === "queued") && fresh(r)))
      .flatMap((r) => r.meta!.compilation!.videoIds),
  );
  const episodeNo = rows.filter((r) => r.meta?.compilation?.episode && r.status !== "failed").length + 1;
  const legacy = rows.filter((r) => !r.meta?.compilation && (r.status === "ready" || r.status === "published") && r.assets["long.mp4"] && !used.has(r.id));
  const candidates: CompileCandidate[] = (episode ? episodeBacklog(rows, now).ready : legacy).map((r) => ({ chapterId: r.chapterId, number: r.number, title: r.title, videoId: r.id }));
  return { active, recentFailed, batch: pickBatch(candidates, episode ? s.episodeChapters : COMPILE_SIZE), rows, episodeNo };
}

/**
 * Không đạt chuẩn → ném QcFailedError (tập bị đánh lỗi, compile thử lại sau, KHÔNG upload). Lỗi gần như luôn nằm ở chương
 * MỞ TẬP (10 phút đầu): chương đó chưa từng render lại theo cách mới thì đánh cờ forceRerender + xếp hàng → lượt daily sau
 * render lại (nhịp nhanh, góc máy, phụ đề) rồi ghép lại. Đã render lại mà vẫn trượt thì chỉ báo, không lặp vô hạn.
 */
async function qcGate(file: string, opener: Row) {
  console.log("● Kiểm chất lượng 10 phút đầu");
  const r = judgeQc(await measureQc(file));
  const m = r.metrics;
  console.log(`  ${(m.cuts / Math.max(1, m.seconds) * 60).toFixed(1)} cắt/phút · đứng im dài nhất ${m.longestFreeze.toFixed(1)}s · màn đen ${m.longestBlack.toFixed(1)}s · ${m.lufs ?? "?"} LUFS`);
  if (r.ok) return;
  const again = !opener.meta?.qcRerendered;
  if (again) {
    await db()
      .update(videos)
      .set({ status: "queued", error: null, updatedAt: new Date(), meta: sql`coalesce(${videos.meta}, '{}'::jsonb) || '{"forceRerender": true, "qcRerendered": true}'::jsonb` })
      .where(eq(videos.id, opener.id));
  }
  throw new QcFailedError(
    `Tập chưa đạt chuẩn (${r.problems.join("; ")}) — ${again ? `xếp hàng render lại chương mở tập #${opener.id}` : `chương #${opener.id} đã render lại mà vẫn trượt, cần xem tay`}`,
  );
}

/** Ghép các file: cùng thông số thì concat copy (nhanh, không mất chất lượng), khác thì re-encode như render. */
async function concatLongs(files: string[], dir: string, out: string, total: number) {
  const list = path.join(dir, "concat.txt");
  await writeFile(list, files.map((f) => `file '${f}'`).join("\n"));
  const sigs = await Promise.all(files.map(streamSignature));
  if (sigs.every((s) => s === sigs[0])) {
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out]);
    // Mốc thời gian lệch (>3s so với tổng) thì copy không đáng tin → dựng lại.
    if (Math.abs((await duration(out)) - total) <= 3) return;
    console.warn("⚠ Concat copy lệch thời lượng — re-encode.");
  } else console.log("  Thông số các chương khác nhau — re-encode.");
  await ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-maxrate", "5M", "-bufsize", "10M", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out,
  ]);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function buildMeta(s: typeof series.$inferSelect, batch: Row[], label: string, durations: number[]) {
  const seo = await keywordResearch(genreSeeds(s.genre));
  const keywords = seo?.keywords.map((k) => k.keyword) ?? [];
  console.log(`  Từ khóa: ${seo?.keywords.slice(0, 6).map((k) => `${k.keyword} (${k.overall})`).join(", ") ?? "không có"}`);
  const hours = (durations.reduce((a, b) => a + b, 0) / 3600).toFixed(1);
  const chaptersText = batch.map((r) => `Chương ${r.number}: ${r.title}${r.summary ? `\n  ${clip(r.summary, 600)}` : ""}`).join("\n");
  const m = await textProvider().generateJson({
    system: "Bạn là chuyên gia YouTube kênh truyện audio tiên hiệp Việt Nam, tối ưu CTR và watch time.",
    prompt: `Đây là BẢN GỘP video dài ${hours} giờ, nghe liền mạch các chương ${label} của một truyện.\n\nTruyện: ${s.title}\nCốt truyện: ${s.premise}\nNhân vật/bối cảnh:\n${s.bible.slice(0, 2000)}\n\nCác chương trong bản gộp:\n${chaptersText}${
      seo ? `\n\nTừ khóa người xem Việt Nam tìm thật trên YouTube (vidIQ, xếp theo điểm). Tiêu đề giật tít KHÔNG chèn từ khóa; đoạn đầu mô tả và tag đầu dùng từ khóa điểm cao; không nhồi nhét:\n${seo.text}` : ""
    }`,
    schema: metaSchema,
    temperature: 0.8,
    tier: "quality",
    task: "meta",
  });
  console.log(`  Meta bởi ${textProvider().lastModel}`);

  const options = [m.title, ...(m.titleAlternatives ?? [])].filter(Boolean);
  const scores = await scoreTitles(options);
  const all = options.map((t, i) => ({ title: t, score: scores?.[i] ?? null }));
  for (const x of all) console.log(`  ${x.score ?? "?"} — ${x.title}`);
  const best = chooseTitle(all);
  return { m, best, all, keywords };
}

/** Gộp 5 chương liền nhau sớm nhất chưa nằm trong bản gộp nào của bộ truyện `seriesId`. */
export async function compileSeries(seriesId: number) {
  await loadSecrets(true);
  const [s] = await db().select().from(series).where(eq(series.id, seriesId));
  if (!s) throw new Error(`Không có bộ truyện #${seriesId}`);
  const episode = s.episodeChapters > 0;
  const size = episode ? s.episodeChapters : COMPILE_SIZE;
  const state = await compileState(s);
  if (state.active) return console.log(`⏭ ${s.title}: đã có bản gộp đang làm — bỏ qua.`);
  if (!state.batch) return console.log(`⏭ ${s.title}: chưa đủ ${size} chương liền nhau đã có video dài — dừng.`);
  // Bản dựng dở của job đã chết: đánh dấu lỗi để UI không treo "đang render" mãi.
  for (const r of state.rows.filter((x) => x.meta?.compilation && x.status === "rendering")) {
    if (Date.now() - r.updatedAt.getTime() >= STALE_HOURS * 3600_000) await db().update(videos).set({ status: "failed", error: "Job dừng giữa chừng", updatedAt: new Date() }).where(eq(videos.id, r.id));
  }
  const batch = state.batch.map((c) => state.rows.find((r) => r.id === c.videoId)!);
  const from = batch[0].number;
  const to = batch[batch.length - 1].number;
  const label = compileLabel(from, to);
  const compilation: NonNullable<VideoMeta["compilation"]> = {
    seriesId, from, to, videoIds: batch.map((r) => r.id), ...(episode ? { episode: true, episodeNo: state.episodeNo } : {}),
  };
  const name = episode ? `Tập ${state.episodeNo} (chương ${label})` : `Bản gộp chương ${label}`;
  console.log(`▶ ${name} — ${s.title} (video ${compilation.videoIds.join(", ")})`);

  // Giữ chỗ ngay (status rendering + compilation) để job daily không dispatch trùng và 5 chương này không bị gộp lần nữa.
  const placeholder: VideoMeta = { title: `${name} (đang dựng)`, description: "", tags: [], shortTitle: "", shortDescription: "", compilation };
  const [row] = await db()
    .insert(videos)
    .values({
      chapterId: batch[batch.length - 1].chapterId, status: "rendering", meta: placeholder,
      runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    })
    .returning({ id: videos.id });
  const videoId = row.id;
  const dir = path.resolve(`.render/compile-${videoId}`);

  try {
    await mkdir(dir, { recursive: true });
    const files: string[] = [];
    for (const r of batch) {
      console.log(`● Tải chương ${r.number} (video #${r.id})`);
      files.push(await downloadAsset(r.id, "long.mp4", path.join(dir, `v${r.id}`)));
    }
    const durations = await Promise.all(files.map(duration));
    const total = durations.reduce((a, b) => a + b, 0);
    console.log(`● Ghép ${files.length} video — ${Math.round(total / 60)} phút`);
    const out = path.join(dir, "long.mp4");
    await concatLongs(files, dir, out, total);
    let seconds = await duration(out);
    for (const f of files) await rm(path.dirname(f), { recursive: true, force: true });

    const credits = collectMusicCredits(batch.map((r) => r.meta?.description ?? ""));
    let meta: VideoMeta;
    let thumb: string | null;
    let thumbs: ThumbVariant[] = [];
    let short: string | null = null;
    if (episode) {
      console.log("● Nội dung tập");
      const chapterRows = await db().select().from(chapters).where(inArray(chapters.id, batch.map((r) => r.chapterId)));
      const prevUrl = state.rows
        .filter((r) => r.meta?.compilation?.episode && r.youtubeUrl)
        .sort((a, b) => (b.meta!.compilation!.episodeNo ?? 0) - (a.meta!.compilation!.episodeNo ?? 0))[0]?.youtubeUrl ?? null;
      const built = await buildEpisodeContent({
        s, dir, videoId, from, to, compilation, credits, episodeNo: state.episodeNo, previousEpisodeUrl: prevUrl,
        chapters: batch.map((r, i) => ({ chapter: chapterRows.find((c) => c.id === r.chapterId)!, seconds: durations[i] })),
      });
      ({ meta, thumb, thumbs, short } = built);
      // Đoạn mở đầu cao trào ghép lên trước chương đầu (concat copy — đã encode trùng thông số chương tĩnh).
      if (built.coldOpen) {
        const withIntro = path.join(dir, "long-intro.mp4");
        await concatLongs([built.coldOpen.file, out], dir, withIntro, built.coldOpen.seconds + seconds);
        await rm(out, { force: true });
        await rename(withIntro, out);
        seconds = await duration(out);
      }
      // Màn kết kêu gọi thích/chia sẻ/đăng ký ghép vào cuối. Mốc mục lục không đổi (chỉ chương cuối dài thêm 15 giây).
      console.log("● Màn kết");
      const outro = await makeOutro({ dir, video: out, videoId, seconds });
      if (outro) {
        const withOutro = path.join(dir, "long-outro.mp4");
        await concatLongs([out, outro.file], dir, withOutro, seconds + outro.seconds);
        await rm(out, { force: true });
        await rename(withOutro, out);
        seconds = await duration(out);
      }
    } else {
    console.log("● Meta");
    const { m, best, all, keywords } = await buildMeta(s, batch, label, durations);
    const marks = buildChapterMarks(batch.map((r, i) => ({ number: r.number, title: r.title, seconds: durations[i] })));
    const draft: VideoMeta = {
      title: best.title.length > 100 ? `${best.title.slice(0, 97)}…` : best.title,
      description: `${m.description}\n\n${AI_NOTE}`,
      tags: m.tags,
      // Bản gộp không có Short — điền sẵn để điểm SEO "Short" không kéo tổng xuống.
      shortTitle: `${s.title} trọn bộ #shorts`,
      shortDescription: `Nghe liền mạch chương ${label} ${s.title} trên kênh #shorts`,
      seo: { titleScore: best.score, titleOptions: all, keywords },
      compilation,
    };
    const fixed = await optimizeMeta(
      draft,
      { seriesTitle: s.title, chapterNumber: to, chapterTitle: `bản gộp chương ${label}, nghe liền mạch`, summary: batch.map((r) => r.summary).filter(Boolean).join("\n") },
      { log: console.log },
    );
    // Mục lục + ghi công nhạc gắn SAU bước tối ưu để AI không xoá/sửa mất.
    const description = [fixed.meta.description, `📑 Mục lục:\n${marks}`, ...credits].join("\n\n");
    meta = { ...fixed.meta, description, compilation };
    console.log(`  Điểm SEO: ${fixed.score}; tiêu đề: ${meta.title}`);

    console.log("● Thumbnail");
    thumb = await makeThumbnail(dir, m, label, batch[batch.length - 1].id);
    }
    const metaFile = path.join(dir, "youtube.txt");
    await writeFile(metaFile, `${meta.title}\n\n${meta.description}\n\nTags: ${meta.tags.join(", ")}\n`);

    // Kiểm chất lượng 10 phút đầu so với kênh top TRƯỚC KHI upload (qc.ts). Chỉ áp cho tập (định dạng đang đăng).
    if (episode) await qcGate(out, batch[0]);

    console.log("● Upload lên kho");
    const releaseId = await ensureRelease(videoId, true);
    for (const f of [out, ...(thumb ? [thumb] : []), ...thumbs.map((t) => t.file), ...(short ? [short] : []), metaFile]) await uploadAsset(videoId, releaseId, f);

    const taken = await db()
      .select({ at: videos.publishAt })
      .from(videos)
      .where(and(isNotNull(videos.publishAt), gte(videos.publishAt, new Date())));
    const publishAt = episode ? await nextPublishSlot() : nextCompileSlot(taken.map((t) => t.at!));
    const publish = await autoPublishEligible(videoId);
    await db()
      .update(videos)
      .set({
        status: "ready", meta, durationSec: Math.round(seconds), publishAt, error: null, updatedAt: new Date(),
        ...(publish ? { uploadStatus: "uploading" as const, uploadError: null } : {}),
      })
      .where(eq(videos.id, videoId));
    await notify(
      `🎞 <b>${episode ? `Tập ${state.episodeNo} sẵn sàng` : "Bản gộp sẵn sàng"}</b>\n${escapeHtml(meta.title)}\n⏱ ${Math.round(seconds / 60)} phút (chương ${label})\n` +
        `📅 Lịch đăng: ${publishAt.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}\n` +
        `👉 ${WEB_URL}/videos/${videoId}`,
    );
    if (publish) await publishToYoutube(videoId, { long: out, thumb: thumb ?? undefined, thumbs, short: short ?? undefined });
    if (process.env.GITHUB_ACTIONS) await rm(dir, { recursive: true, force: true });
    console.log(`✔ Xong ${name} #${videoId} (${Math.round(seconds / 60)} phút)`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().update(videos).set({ status: "failed", error: msg.slice(0, 2000), updatedAt: new Date() }).where(eq(videos.id, videoId));
    await notify(`❌ <b>${episode ? `Tập ${state.episodeNo}` : "Bản gộp"} lỗi</b> ${escapeHtml(s.title)} — chương ${label}\n${escapeHtml(msg.slice(0, 300))}\n👉 ${WEB_URL}/videos/${videoId}`);
    throw e;
  } finally {
    await closeVidiq();
  }
}

/** Thumbnail mới (cận mặt nhân vật chính); AI vẽ lỗi / hết quota thì dùng lại thumbnail chương cuối, không có thì đăng không thumbnail. */
async function makeThumbnail(dir: string, m: z.infer<typeof metaSchema>, label: string, lastVideoId: number) {
  try {
    return await thumbnail(dir, `${m.thumbnailPrompt}, ${m.characterLook}`, m.thumbnailText);
  } catch (e) {
    console.warn(`⚠ Thumbnail AI lỗi${e instanceof QuotaExhaustedError ? " (hết quota)" : ""}, dùng thumbnail chương cuối:`, e instanceof Error ? e.message : e);
    return downloadAsset(lastVideoId, "thumbnail.jpg", path.join(dir, "fallback")).catch(() => null);
  }
}

/** Tải 1 file từ release `video-<id>` về `dir`. */
async function downloadAsset(videoId: number, name: string, dir: string) {
  await mkdir(dir, { recursive: true });
  const repo = process.env.GITHUB_REPOSITORY ? ["--repo", process.env.GITHUB_REPOSITORY] : [];
  await run("gh", ["release", "download", `video-${videoId}`, "-p", name, "-D", dir, "--clobber", ...repo], { maxBuffer: 16 * 1024 * 1024 });
  return path.join(dir, name);
}
