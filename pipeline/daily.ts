import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos, type Series } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { planChapters, writeChapterStep } from "@/lib/story/service";
import { maxContinues } from "@/lib/story/prompts";
import { quotaDay } from "@/lib/ai/usage";
import { aiUsage } from "@/db/schema";
import { isLifeStory } from "@/lib/story/life";
import { HISTORY_GENRE, isHistoryStory, pickChapterToWrite } from "@/lib/story/history";
import { FactCheckFailedError } from "@/lib/story/fact-check";
import { loadSecrets } from "@/lib/secrets";
import { ensureWebsub } from "@/lib/websub";
import { commentOnPublished, postPendingCreditComments } from "./comment";
import { compileSeries, compileState, seriesRows, withStaleAsFailed } from "./compile";
import { chaptersToWrite, episodeBacklog, focusChannel, type FocusChannel, vnDay, writtenMarker } from "./episode-plan";
import { countHistoryBacklog, HISTORY_BUFFER } from "./history-script";
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

const MINUTES_PER_HOUR = 60;
const MS_PER_MINUTE = 60_000;
/** Video kẹt "đang render" im lặng quá ngần này phút coi là chắc chắn kẹt (job bị huỷ/hết giờ giữa chừng). */
const STUCK_MINUTES = 30;
/** Video lịch sử dựng tới 4,5 giờ máy — ngưỡng kẹt phải dài hơn hẳn, không thì video đang dựng dở bị requeue giữa chừng. */
const HISTORY_STUCK_HOURS = 7;
const HISTORY_STUCK_MINUTES = HISTORY_STUCK_HOURS * MINUTES_PER_HOUR;

/** Video "đang render" im lặng quá ngưỡng (thường/lịch sử) thì coi là kẹt, cần xếp lại hàng đợi. */
export function isRenderStuck(history: boolean, updatedAt: Date, now = new Date()): boolean {
  const minutes = (now.getTime() - updatedAt.getTime()) / MS_PER_MINUTE;
  return minutes >= (history ? HISTORY_STUCK_MINUTES : STUCK_MINUTES);
}

/**
 * Video kẹt "đang render" (job bị huỷ/hết giờ giữa chừng): render đang chạy có nhịp tim mỗi phút, nên im lặng
 * quá ngưỡng là chắc chắn kẹt → trả về hàng đợi để render lại (phần đã làm nằm trong cache .render). Video lịch
 * sử dựng tới 4,5 giờ nên chờ lâu hơn hẳn trước khi coi là kẹt (xem `isRenderStuck`).
 */
async function requeueStuck() {
  const rendering = await db()
    .select({ id: videos.id, updatedAt: videos.updatedAt, genre: series.genre })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .where(and(eq(videos.status, "rendering"), sql`${videos.meta}->'compilation' is null`));
  const ids = rendering.filter((v) => isRenderStuck(isHistoryStory(v), v.updatedAt)).map((v) => v.id);
  if (!ids.length) return;
  // Chốt lại điều kiện "còn đang render" trong chính câu UPDATE — giữa lúc SELECT và UPDATE, job kia có thể vừa xong.
  const stuck = await db()
    .update(videos)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(inArray(videos.id, ids), eq(videos.status, "rendering")))
    .returning({ id: videos.id });
  for (const v of stuck) console.log(`↻ Video #${v.id} kẹt "đang render" — xếp hàng render lại`);
}

/** Số chương render song song (runner trên Mac: 10 nhân/8GB Docker; mỗi chương đã chạy 3 luồng ffmpeg). */
const RENDER_PARALLEL = Math.max(1, Number(process.env.RENDER_PARALLEL ?? 2));

/** Tiến độ của lượt này: có làm được gì và có đụng trần quota không — quyết định có tự gọi lượt kế tiếp (chainNextRun). */
const run = { rendered: 0, written: 0, quotaHit: false };

/** Một video chờ render trong hàng đợi chung (không gồm lịch sử — `historyauto` lo trọn vòng riêng). */
export type RenderQueueRow = { id: number; channel: string; genre: string };

/**
 * Thứ tự hàng đợi render: kênh phụ (đang ưu tiên) trước kênh gốc, cùng kênh theo thứ tự id; video lịch sử
 * không vào đây (dựng bằng `renderVideo` chung là sai pipeline); ngày kênh lịch sử thì chuyện đời cũng
 * nhường lượt vẽ ảnh, chỉ render tay mới chạy.
 */
export function renderQueueOrder(rows: RenderQueueRow[], focus: FocusChannel): RenderQueueRow[] {
  return rows
    .filter((v) => !isHistoryStory(v))
    .filter((v) => v.channel !== "chuyen-doi" || focus === "chuyen-doi")
    .sort((a, b) => Number(a.channel === "main") - Number(b.channel === "main") || a.id - b.id);
}

async function renderQueue(failures: string[]) {
  await requeueStuck();
  // Bộ truyện tắt autopilot (kênh gốc tạm dừng 18/11/2026) không render tự động — dồn giọng/ảnh cho kênh đang chạy; render tay vẫn được.
  const queue = renderQueueOrder(
    await db()
      .select({ id: videos.id, channel: series.channel, genre: series.genre })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(and(eq(videos.status, "queued"), eq(series.autopilot, true)))
      .orderBy(asc(videos.id)),
    focusChannel(),
  );
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
    // Lịch sử: mỗi video đã trọn một sự kiện, tự đăng qua historyAuto — gộp bằng renderVideo chung là sai pipeline.
    if (isLifeStory(s) || isHistoryStory(s)) continue;
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
 * Có nên dispatch job lịch sử kế tiếp không — kho (đếm bằng `countHistoryBacklog`, mọi trạng thái chưa phát
 * xong, KHÔNG phải riêng "ready") chưa đủ `HISTORY_BUFFER`. `historyAuto` tự quyết việc cụ thể (hoàn tất/dựng/
 * viết đề tài mới) nên dispatch dư (vd lúc đang có video rendering) chỉ tốn nhiều nhất một lượt viết đề tài mới,
 * không bao giờ dựng trùng.
 */
export function shouldDispatchHistoryAuto(backlogCount: number, buffer = HISTORY_BUFFER): boolean {
  return backlogCount < buffer;
}

/** Dispatch render.yml "historyauto:<seriesId>" (job riêng — dựng tới 4,5 giờ, không chặn hàng đợi daily). Lỗi chỉ báo, không làm hỏng job. */
async function dispatchHistoryAuto(seriesId: number) {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY ?? process.env.GH_REPO;
  if (!token || !repo) {
    console.log(`  Bộ lịch sử #${seriesId}: thiếu quyền actions:write — bỏ qua, chạy tay "historyauto:${seriesId}"`);
    return;
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/render.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    body: JSON.stringify({ ref: "main", inputs: { video_id: `historyauto:${seriesId}` } }),
  }).catch((e) => ({ ok: false, status: String(e) }) as const);
  if (!res.ok) console.log(`  Bộ lịch sử #${seriesId}: dispatch lỗi ${res.status}`);
}

/**
 * Ngày kênh lịch sử (focusChannel): mỗi bộ lịch sử đang tự chạy dispatch job riêng nếu chưa đủ kho — dựng tới
 * 4,5 giờ nên không chạy trong job daily (chặn hàng đợi, dễ chạm trần 355 phút). Lỗi dispatch chỉ báo, không làm hỏng job.
 */
async function dispatchHistoryJobs() {
  for (const s of await db().select().from(series).where(and(eq(series.autopilot, true), eq(series.genre, HISTORY_GENRE)))) {
    const rows = await db()
      .select({ status: videos.status, publishAt: videos.publishAt, meta: videos.meta })
      .from(videos)
      .innerJoin(chapters, eq(chapters.id, videos.chapterId))
      .where(eq(chapters.seriesId, s.id));
    const backlog = countHistoryBacklog(rows);
    if (!shouldDispatchHistoryAuto(backlog)) {
      console.log(`  ${s.title}: đủ kho (${backlog}/${HISTORY_BUFFER}) — chưa dispatch thêm`);
      continue;
    }
    console.log(`🎬 ${s.title}: dispatch historyauto:${s.id} (kho ${backlog}/${HISTORY_BUFFER})`);
    await dispatchHistoryAuto(s.id);
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

/**
 * Viết chương cho từng bộ trong `list` tới khi đủ chỉ tiêu ngày; dừng sớm cả danh sách khi hết quota AI free.
 * Trả `quotaLeft` mới (false = các lượt gọi `writeSeries` sau trong cùng lượt daily cũng nên dừng).
 */
async function writeSeries(list: Series[], failures: string[], quotaLeft: boolean): Promise<boolean> {
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
  return quotaLeft;
}

async function main() {
  await loadSecrets(true);
  // Webhook YouTube (đổi tiêu đề/mô tả → app kéo về ngay): gia hạn khi sắp hết hạn. Lỗi không chặn daily.
  await ensureWebsub()
    .then((r) => console.log(`WebSub: ${r}`))
    .catch((e) => console.warn("⚠ WebSub:", e instanceof Error ? e.message : e));
  const failures: string[] = [];
  let quotaLeft = true;
  // Lịch sử tự chạy trọn vòng riêng (historyAuto, dispatch job riêng ở dưới) — không viết/duyệt/render qua writeSeries/renderQueue.
  const autopilot = (await db().select().from(series).where(eq(series.autopilot, true))).filter((s) => !isHistoryStory(s)).sort((a, b) => a.id - b.id);
  // Kênh phụ (Chuyện Đời Lắng Đọng) đang được ưu tiên: viết chương của nó TRƯỚC khi render hàng đợi — hàng đợi kênh gốc
  // có thể dài nhiều giờ (giọng đọc free) nên viết sau thì cả ngày kênh mới không có truyện.
  quotaLeft = await writeSeries(autopilot.filter((s) => s.channel !== "main"), failures, quotaLeft);
  await renderQueue(failures);
  // Ngày kênh lịch sử: dispatch job riêng dựng tiếp (dựng tới 4,5 giờ, không chạy trong job này). Lỗi chỉ báo.
  if (focusChannel() === "lich-su") await dispatchHistoryJobs().catch((e) => failures.push(`dispatch lịch sử: ${e instanceof Error ? e.message : e}`));
  // Bình luận kêu gọi thích/chia sẻ/đăng ký cho video ĐÃ tới giờ phát (video lên lịch còn private thì YouTube không nhận bình luận).
  await commentOnPublished().catch((e) => console.warn("⚠ Bình luận kêu gọi:", e instanceof Error ? e.message : e));
  // Lịch sử: ảnh ghi công không vừa mô tả (meta.overflowCredits) đăng bù thành bình luận khi video đã công khai.
  await postPendingCreditComments().catch((e) => console.warn("⚠ Bình luận ghi công ảnh dư:", e instanceof Error ? e.message : e));
  quotaLeft = await writeSeries(autopilot.filter((s) => s.channel === "main"), failures, quotaLeft);

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

// CLI: tsx pipeline/daily.ts — chạy main() thật; import module này (test) không tự chạy job.
if (process.argv[1]?.endsWith("daily.ts")) main().then(() => process.exit(0));
