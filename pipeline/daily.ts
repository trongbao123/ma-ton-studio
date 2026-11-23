import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { planChapters, writeChapterStep } from "@/lib/story/service";
import { maxContinues } from "@/lib/story/prompts";
import { quotaDay } from "@/lib/ai/usage";
import { aiUsage } from "@/db/schema";
import { isLifeStory } from "@/lib/story/life";
import { pickChapterToWrite } from "@/lib/story/history";
import { FactCheckFailedError } from "@/lib/story/fact-check";
import { loadSecrets } from "@/lib/secrets";
import { ensureWebsub } from "@/lib/websub";
import { commentOnPublished } from "./comment";
import { compileSeries, compileState, seriesRows, withStaleAsFailed } from "./compile";
import { chaptersToWrite, episodeBacklog, focusChannel, vnDay, writtenMarker } from "./episode-plan";
import { renderVideo } from "./render";
import { pool } from "./ffmpeg";

/** Số chương chờ duyệt tối đa khi không tự duyệt — tránh viết dồn khi người dùng chưa kịp đọc. */
const MAX_PENDING = 3;


async function writeNext(seriesId: number, targetWords: number): Promise<{ id: number; number: number; title: string; words: number }> {
  const list = await db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
  // Đề tài lịch sử "chờ sửa" (còn lỗi sự thật) không tính là còn dàn ý và không được viết lại tự động.
  if (list.filter((c) => c.status === "outline" && c.factIssues == null).length < 2) {
    console.log("  lên dàn ý 10 chương");
    // Không thêm được chương nào (lịch sử: AI đề xuất toàn đề tài bị loại) → dừng, không gọi AI lặp mãi tới hết quota.
    if (!(await planChapters(seriesId, 10))) throw new Error("Lên dàn ý không ra chương nào hợp lệ (đề tài nhạy cảm/thiếu Wikipedia) — xem lại prompt dàn ý.");
    return writeNext(seriesId, targetWords);
  }
  const next = pickChapterToWrite(list)!;
  console.log(`  viết chương ${next.number}: ${next.title}`);
  let r = await writeChapterStep(next.id, next.content ? "continue" : "start");
  if (r.warning) {
    console.warn(`⚠ Chương ${next.number}: ${r.warning}`);
    await notify(`⚠️ Chương ${next.number} — ${escapeHtml(next.title)}: ${escapeHtml(r.warning)}`);
  }
  for (let i = 0; i < maxContinues(targetWords) && !r.enough; i++) r = await writeChapterStep(next.id, "continue");
  const done = await writeChapterStep(next.id, "finish");
  return { id: next.id, number: next.number, title: next.title, words: done.words };
}

/**
 * Ghi nhận lỗi khi viết một bộ. Trả true nếu là hết quota (dừng viết các bộ sau). Lỗi sự thật kênh lịch sử đã báo Telegram
 * và chuyển đề tài sang "chờ sửa" — không tính là lỗi hệ thống.
 */
async function reportWriteError(e: unknown, seriesTitle: string, failures: string[]): Promise<boolean> {
  if (e instanceof QuotaExhaustedError) {
    console.log(`⏸ ${e.message}`);
    run.quotaHit = true;
    await notifyQuotaOnce(e.message);
    return true;
  }
  if (e instanceof FactCheckFailedError) {
    console.log(`  ⚠ ${e.message} — chờ sửa, lượt sau viết đề tài kế`);
    return false;
  }
  console.error(e);
  failures.push(`${seriesTitle}: ${e instanceof Error ? e.message : e}`);
  return false;
}

/** Báo hết quota tối đa 1 lần mỗi ngày quota — job chạy 3 tiếng/lần, không spam. */
async function notifyQuotaOnce(message: string) {
  const day = quotaDay();
  const [mark] = await db()
    .insert(aiUsage)
    .values({ day, model: "_notified_quota", calls: 1 })
    .onConflictDoNothing()
    .returning();
  if (mark) await notify(`⏸ Hết lượt AI free hôm nay — tự chạy tiếp khi quota reset (~14–15h).\n${escapeHtml(message.slice(0, 200))}`);
}

/**
 * Video kẹt "đang render" (job bị huỷ/hết giờ giữa chừng): render đang chạy có nhịp tim mỗi phút,
 * nên 30 phút im lặng là chắc chắn kẹt → trả về hàng đợi để render lại (phần đã làm nằm trong cache .render).
 */
async function requeueStuck() {
  const stuck = await db()
    .update(videos)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(videos.status, "rendering"), lt(videos.updatedAt, new Date(Date.now() - 30 * 60_000)), sql`${videos.meta}->'compilation' is null`))
    .returning({ id: videos.id });
  for (const v of stuck) console.log(`↻ Video #${v.id} kẹt "đang render" — xếp hàng render lại`);
}

/** Số chương render song song (runner trên Mac: 10 nhân/8GB Docker; mỗi chương đã chạy 3 luồng ffmpeg). */
const RENDER_PARALLEL = Math.max(1, Number(process.env.RENDER_PARALLEL ?? 2));

/** Tiến độ của lượt này: có làm được gì và có đụng trần quota không — quyết định có tự gọi lượt kế tiếp (chainNextRun). */
const run = { rendered: 0, written: 0, quotaHit: false };

async function renderQueue(failures: string[]) {
  await requeueStuck();
  // Video của kênh phụ (đang được ưu tiên) render trước, trong cùng kênh thì theo thứ tự id.
  // Bộ truyện tắt autopilot (kênh gốc tạm dừng 18/11/2026) không render tự động — dồn giọng/ảnh cho kênh đang chạy; render tay vẫn được.
  const queue = (
    await db()
      .select({ id: videos.id, channel: series.channel })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(and(eq(videos.status, "queued"), eq(series.autopilot, true)))
      .orderBy(asc(videos.id))
  )
    .sort((a, b) => Number(a.channel === "main") - Number(b.channel === "main") || a.id - b.id)
    // Ngày lịch sử: không render tự động video chuyện đời — dành lượt vẽ ảnh cho kênh lịch sử (render tay vẫn được).
    .filter((v) => v.channel !== "chuyen-doi" || focusChannel() === "chuyen-doi");
  if (focusChannel() === "lich-su") console.log("  Hôm nay là ngày kênh lịch sử — tạm không render video chuyện đời");
  let quota: string | null = null;
  // Nhiều luồng: RENDER_PARALLEL chương cùng lúc; hết quota thì không bắt đầu chương mới (chương đang chạy tự dừng ở quota).
  await pool(queue, RENDER_PARALLEL, async (v) => {
    if (quota) return;
    try {
      await renderVideo(v.id);
      run.rendered++;
    } catch (e) {
      if (e instanceof QuotaExhaustedError) {
        quota = e.message;
        run.quotaHit = true;
        return;
      }
      failures.push(`video #${v.id}: ${e instanceof Error ? e.message : e}`);
    }
  });
  if (quota) {
    console.log(`⏸ ${quota}`);
    await notifyQuotaOnce(quota);
  }
}

/**
 * Thử dispatch render.yml (job riêng); token của job daily thiếu quyền `actions: write` (403) thì gộp ngay trong job này
 * (daily có 240 phút, ghép thường chỉ copy luồng nên vài phút).
 */
async function dispatchCompile(seriesId: number) {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY ?? process.env.GH_REPO;
  if (token && repo) {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/render.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ ref: "main", inputs: { video_id: `compile:${seriesId}` } }),
    });
    if (res.ok) return;
    console.log(`  dispatch bản gộp ${res.status} — gộp ngay trong job daily`);
  }
  await compileSeries(seriesId);
}

/** Đủ chương đã render chưa nằm trong bản gộp nào thì kích hoạt gộp. Lỗi dispatch chỉ báo (1 lần/ngày), không làm hỏng job. */
async function dispatchCompilations() {
  for (const s of await db().select().from(series).where(eq(series.autopilot, true))) {
    // Chuyện đời: mỗi truyện đăng riêng — gộp 5 truyện khác nhau thành 1 video là vô nghĩa.
    if (isLifeStory(s)) continue;
    const { active, recentFailed, batch } = await compileState(s);
    if (!batch) continue;
    if (active || recentFailed) {
      console.log(`  ${s.title}: đủ chương để gộp nhưng ${active ? "đang có bản gộp chạy" : "bản gộp trước vừa lỗi (chờ 24h)"} — bỏ qua`);
      continue;
    }
    const range = `${batch[0].number}–${batch[batch.length - 1].number}`;
    try {
      // Chế độ tập: ghép ngay trong job daily (đỡ phút Actions của job riêng, kịp 15h); bản gộp 5 chương cũ bị tắt.
      if (s.episodeChapters > 0) {
        // Đang viết bù kho (tới 6 chương/ngày) thì 1 lượt có thể đủ 2 tập: ghép tối đa 2, lượt 2 tự bỏ qua nếu chưa đủ chương.
        await compileSeries(s.id);
        await compileSeries(s.id);
      } else await dispatchCompile(s.id);
      console.log(`🎞 ${s.title}: ${s.episodeChapters > 0 ? "dựng tập" : "kích hoạt bản gộp"} chương ${range}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Không kích hoạt được bản gộp ${s.title}: ${msg}`);
      const [mark] = await db().insert(aiUsage).values({ day: quotaDay(), model: `_notified_compile_${s.id}`, calls: 1 }).onConflictDoNothing().returning();
      if (mark) await notify(`⚠️ Đủ chương để gộp <b>${escapeHtml(s.title)}</b> (${range}) nhưng không tự kích hoạt được: ${escapeHtml(msg)}\nChạy tay: render.yml với video_id = compile:${s.id}`);
    }
  }
}

/**
 * Sản xuất liên tục: lượt này làm được việc (viết/render) mà chưa đụng trần quota thì tự gọi lượt daily kế tiếp ngay
 * (concurrency của workflow xếp nó chạy sau lượt này) — không chờ cron 12 tiếng. Hết quota / không còn việc thì thôi, cron đánh thức lại.
 * Tắt: biến repo DAILY_CHAIN = 0.
 */
async function chainNextRun() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo || process.env.DAILY_CHAIN === "0") return;
  if (run.quotaHit || run.rendered + run.written === 0) {
    console.log(`⏹ Không gọi lượt kế tiếp (${run.quotaHit ? "đã hết quota" : "không còn việc"}) — chờ cron`);
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/daily.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main" }),
  }).catch((e) => ({ ok: false, status: String(e) }) as const);
  console.log(res.ok ? `⏭ Đã gọi lượt daily kế tiếp (lượt này: ${run.written} chương viết, ${run.rendered} video render)` : `⚠ Không gọi được lượt kế tiếp: ${res.status}`);
}

/** Quét xu hướng nếu hôm nay chưa quét (cần vidIQ). */
async function scanTrendsDaily() {
  if (!process.env.VIDIQ_API_KEY) return;
  const { scanTrends, trendsScannedToday } = await import("./trends");
  if (await trendsScannedToday()) return;
  console.log("📈 Quét xu hướng YouTube");
  await scanTrends();
}

/**
 * Chạy 3 tiếng/lần: render hàng đợi trước, rồi viết chương tới khi đủ chỉ tiêu ngày hoặc hết quota free.
 * Hết quota không phải lỗi — lần chạy sau làm tiếp.
 */
/** Số video chương làm sẵn chờ đăng (mỗi ngày đăng 1 lúc 15h). */
const BUFFER = 3;

async function main() {
  await loadSecrets(true);
  // Webhook YouTube (đổi tiêu đề/mô tả → app kéo về ngay): gia hạn khi sắp hết hạn. Lỗi không chặn daily.
  await ensureWebsub()
    .then((r) => console.log(`WebSub: ${r}`))
    .catch((e) => console.warn("⚠ WebSub:", e instanceof Error ? e.message : e));
  const failures: string[] = [];
  let quotaLeft = true;
  const autopilot = (await db().select().from(series).where(eq(series.autopilot, true))).sort((a, b) => a.id - b.id);
  // Kênh phụ (Chuyện Đời Lắng Đọng) đang được ưu tiên: viết chương của nó TRƯỚC khi render hàng đợi — hàng đợi kênh gốc
  // có thể dài nhiều giờ (giọng đọc free) nên viết sau thì cả ngày kênh mới không có truyện.
  await writeSeries(autopilot.filter((s) => s.channel !== "main"));
  await renderQueue(failures);
  // Bình luận kêu gọi thích/chia sẻ/đăng ký cho video ĐÃ tới giờ phát (video lên lịch còn private thì YouTube không nhận bình luận).
  await commentOnPublished().catch((e) => console.warn("⚠ Bình luận kêu gọi:", e instanceof Error ? e.message : e));
  await writeSeries(autopilot.filter((s) => s.channel === "main"));

  async function writeSeries(list: typeof autopilot) {
  for (const s of list) {
    if (!quotaLeft) break;
    console.log(`▶ ${s.title}`);
    try {
      // Viết trước, đăng theo lịch: giữ sẵn kho video/tập chưa lên sóng. Đủ kho thì thôi viết → không đốt quota và phút Actions.
      const now = new Date();
      let want: number;
      if (s.episodeChapters > 0) {
        // Chế độ tập: chỉ tiêu theo marker "đã viết hôm nay" (ngày VN), kho tính theo tập chờ đăng + chương lẻ chưa vào tập.
        const { upcoming, loose } = episodeBacklog(withStaleAsFailed(await seriesRows(s.id), now), now);
        const [mark] = await db().select({ calls: aiUsage.calls }).from(aiUsage).where(and(eq(aiUsage.day, vnDay(now)), eq(aiUsage.model, writtenMarker(s.id))));
        want = chaptersToWrite({
          chaptersPerDay: s.chaptersPerDay, writtenToday: mark?.calls ?? 0,
          stockChapters: upcoming.length * s.episodeChapters + loose.length, episodeChapters: s.episodeChapters,
        });
        // Giọng đọc free (~10 lượt/model/ngày, chương 40 phút tốn ~10 lượt) là nút cổ chai: còn ≥ 1 tập chương chưa render thì
        // thôi viết thêm — viết dồn chỉ tốn lượt Claude mà không ra video nhanh hơn.
        const unrendered = loose.filter((v) => v.status === "queued" || v.status === "rendering").length;
        if (unrendered >= s.episodeChapters) want = 0;
        console.log(`  tập: ${upcoming.length} chờ đăng, ${loose.length} chương lẻ (${unrendered} chưa render), đã viết hôm nay ${mark?.calls ?? 0}/${s.chaptersPerDay} → viết thêm ${want}`);
      } else {
        const stock = (
          await db()
            .select({ id: videos.id, status: videos.status, publishAt: videos.publishAt, meta: videos.meta })
            .from(videos)
            .innerJoin(chapters, eq(chapters.id, videos.chapterId))
            .where(eq(chapters.seriesId, s.id))
        ).filter((v) => !v.meta?.compilation && v.status !== "failed" && (!v.publishAt || v.publishAt > now));
        want = Math.min(s.chaptersPerDay, Math.max(0, BUFFER - stock.length));
        if (!want) console.log(`  kho đủ ${stock.length}/${BUFFER} video chờ đăng — chưa cần viết thêm`);
        }
      for (let done = 0; done < want; done++) {
        const pending = await db()
          .select({ id: chapters.id })
          .from(chapters)
          .where(and(eq(chapters.seriesId, s.id), eq(chapters.status, "draft")));
        if (!s.autoApprove && pending.length >= MAX_PENDING) {
          console.log(`  dừng: đã có ${pending.length} chương chờ duyệt`);
          break;
        }
        const ch = await writeNext(s.id, s.targetWords);
        run.written++;
        // Marker ngay sau khi viết xong (không đếm theo chapters.updatedAt vì sửa SEO/duyệt cũng đổi nó).
        await db()
          .insert(aiUsage)
          .values({ day: vnDay(), model: writtenMarker(s.id), calls: 1 })
          .onConflictDoUpdate({ target: [aiUsage.day, aiUsage.model], set: { calls: sql`${aiUsage.calls} + 1` } });
        if (s.autoApprove) {
          await db().update(chapters).set({ status: "approved", updatedAt: new Date() }).where(eq(chapters.id, ch.id));
          await db().insert(videos).values({ chapterId: ch.id });
        }
        await notify(
          `📝 <b>${escapeHtml(s.title)}</b> — chương ${ch.number}: ${escapeHtml(ch.title)} (${ch.words} từ)\n` +
            (s.autoApprove ? "Đã tự duyệt, đang xếp hàng render." : `Chờ đạo hữu duyệt 👉 ${WEB_URL}/chapters/${ch.id}`),
        );
      }
    } catch (e) {
      if (await reportWriteError(e, s.title, failures)) quotaLeft = false;
    }
  }
  }

  await renderQueue(failures);
  // Xu hướng YouTube: tối đa 1 lần/ngày; lỗi không làm hỏng job.
  await scanTrendsDaily().catch((e) => console.warn("⚠ Quét xu hướng lỗi:", e instanceof Error ? e.message : e));
  // Chương vừa viết thì render luôn trong lượt này (không đợi 6 tiếng sau).
  if (quotaLeft) await renderQueue(failures);
  await dispatchCompilations().catch((e) => failures.push(`bản gộp: ${e instanceof Error ? e.message : e}`));
  // Tập dựng xong lên YouTube ở chế độ riêng tư + lịch; xếp lại lịch xoay vòng các bộ (mỗi ngày một bộ). Lỗi không làm hỏng job.
  await import("./schedule").then((x) => x.rotateSchedule()).catch((e) => console.warn("⚠ Xếp lịch xoay vòng lỗi:", e instanceof Error ? e.message : e));
  // Chủ kênh 18/11/2026: NGƯNG Short (lên view nhanh nhưng ăn hết view video dài) — không bù Short, không cắt cảnh làm Short.
  // Bật lại: gọi lại short-backfill.backfillEpisodeShorts() và clips.makeSceneClips() ở đây + bật makeShort của bộ truyện.
  await chainNextRun();
  if (failures.length) {
    await notify(`❌ <b>Job tự động có lỗi</b>\n${escapeHtml(failures.join("\n").slice(0, 800))}`);
    console.error("Lỗi:\n" + failures.join("\n"));
    process.exit(1);
  }
}

main().then(() => process.exit(0));
