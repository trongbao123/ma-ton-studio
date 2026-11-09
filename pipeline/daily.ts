import { and, asc, eq, gte, ne } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { escapeHtml, notify, WEB_URL } from "@/lib/notify";
import { planChapters, writeChapterStep } from "@/lib/story/service";
import { quotaDay } from "@/lib/ai/usage";
import { aiUsage } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
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

async function renderQueue(failures: string[]) {
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
  if (failures.length) {
    await notify(`❌ <b>Job tự động có lỗi</b>\n${escapeHtml(failures.join("\n").slice(0, 800))}`);
    console.error("Lỗi:\n" + failures.join("\n"));
    process.exit(1);
  }
}

main().then(() => process.exit(0));
