import { and, asc, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { planChapters, writeChapterStep } from "@/lib/story/service";
import { quotaDay } from "@/lib/ai/usage";
import { aiUsage } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { compileSeries, compileState } from "./compile";
import { renderVideo } from "./render";

/** Số chương chờ duyệt tối đa khi không tự duyệt — tránh viết dồn khi người dùng chưa kịp đọc. */
const MAX_PENDING = 3;

/** 0h hôm nay giờ Việt Nam (UTC+7). */
function startOfTodayVN() {
  const now = new Date(Date.now() + 7 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 7 * 3600_000);
}

async function writeNext(seriesId: number): Promise<{ id: number; number: number; title: string; words: number }> {
  const list = await db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
  if (list.filter((c) => c.status === "outline").length < 2) {
    console.log("  lên dàn ý 10 chương");
    await planChapters(seriesId, 10);
    return writeNext(seriesId);
  }
  const next = list.find((c) => c.status === "outline")!;
  console.log(`  viết chương ${next.number}: ${next.title}`);
  let r = await writeChapterStep(next.id, next.content ? "continue" : "start");
  for (let i = 0; i < 2 && !r.enough; i++) r = await writeChapterStep(next.id, "continue");
  const done = await writeChapterStep(next.id, "finish");
  return { id: next.id, number: next.number, title: next.title, words: done.words };
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

async function renderQueue(failures: string[]) {
  await requeueStuck();
  for (const v of await db().select().from(videos).where(eq(videos.status, "queued")).orderBy(asc(videos.id))) {
    try {
      await renderVideo(v.id);
    } catch (e) {
      if (e instanceof QuotaExhaustedError) {
        console.log(`⏸ ${e.message}`);
        await notifyQuotaOnce(e.message);
        return;
      }
      failures.push(`video #${v.id}: ${e instanceof Error ? e.message : e}`);
    }
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
    const { active, recentFailed, batch } = await compileState(s.id);
    if (!batch) continue;
    if (active || recentFailed) {
      console.log(`  ${s.title}: đủ chương để gộp nhưng ${active ? "đang có bản gộp chạy" : "bản gộp trước vừa lỗi (chờ 24h)"} — bỏ qua`);
      continue;
    }
    const range = `${batch[0].number}–${batch[batch.length - 1].number}`;
    try {
      await dispatchCompile(s.id);
      console.log(`🎞 ${s.title}: kích hoạt bản gộp chương ${range}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Không kích hoạt được bản gộp ${s.title}: ${msg}`);
      const [mark] = await db().insert(aiUsage).values({ day: quotaDay(), model: `_notified_compile_${s.id}`, calls: 1 }).onConflictDoNothing().returning();
      if (mark) await notify(`⚠️ Đủ chương để gộp <b>${escapeHtml(s.title)}</b> (${range}) nhưng không tự kích hoạt được: ${escapeHtml(msg)}\nChạy tay: render.yml với video_id = compile:${s.id}`);
    }
  }
}

/**
 * Chạy 3 tiếng/lần: render hàng đợi trước, rồi viết chương tới khi đủ chỉ tiêu ngày hoặc hết quota free.
 * Hết quota không phải lỗi — lần chạy sau làm tiếp.
 */
async function main() {
  await loadSecrets(true);
  const failures: string[] = [];
  await renderQueue(failures);

  let quotaLeft = true;
  for (const s of await db().select().from(series).where(eq(series.autopilot, true))) {
    if (!quotaLeft) break;
    console.log(`▶ ${s.title}`);
    try {
      const writtenToday = await db()
        .select({ id: chapters.id })
        .from(chapters)
        .where(and(eq(chapters.seriesId, s.id), ne(chapters.status, "outline"), gte(chapters.updatedAt, startOfTodayVN())));
      for (let done = writtenToday.length; done < s.chaptersPerDay; done++) {
        const pending = await db()
          .select({ id: chapters.id })
          .from(chapters)
          .where(and(eq(chapters.seriesId, s.id), eq(chapters.status, "draft")));
        if (!s.autoApprove && pending.length >= MAX_PENDING) {
          console.log(`  dừng: đã có ${pending.length} chương chờ duyệt`);
          break;
        }
        const ch = await writeNext(s.id);
        if (s.autoApprove) {
          await db().update(chapters).set({ status: "approved", updatedAt: new Date() }).where(eq(chapters.id, ch.id));
          await db().insert(videos).values({ chapterId: ch.id });
        }
        await notify(
          `📝 <b>${escapeHtml(s.title)}</b> — chương ${ch.number}: ${escapeHtml(ch.title)} (${ch.words} từ)\n` +
            (s.autoApprove ? "Đã tự duyệt, đang xếp hàng render." : `Chờ đạo hữu duyệt 👉 ${WEB_URL}/chapters/${ch.id}`),
        );
      }
      if (writtenToday.length >= s.chaptersPerDay) console.log(`  đủ ${s.chaptersPerDay} chương hôm nay`);
    } catch (e) {
      if (e instanceof QuotaExhaustedError) {
        console.log(`⏸ ${e.message}`);
        quotaLeft = false;
        await notifyQuotaOnce(e.message);
      } else {
        console.error(e);
        failures.push(`${s.title}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await renderQueue(failures);
  await dispatchCompilations().catch((e) => failures.push(`bản gộp: ${e instanceof Error ? e.message : e}`));
  if (failures.length) {
    await notify(`❌ <b>Job tự động có lỗi</b>\n${escapeHtml(failures.join("\n").slice(0, 800))}`);
    console.error("Lỗi:\n" + failures.join("\n"));
    process.exit(1);
  }
}

main().then(() => process.exit(0));
