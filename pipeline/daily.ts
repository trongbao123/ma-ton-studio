import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { planChapters, writeChapterStep } from "@/lib/story/service";
import { renderVideo } from "./render";

/** Số chương AI viết sẵn chờ duyệt tối đa — tránh viết dồn khi người dùng chưa kịp đọc. */
const MAX_PENDING = 3;

async function writeNext(seriesId: number) {
  const list = await db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
  if (list.filter((c) => c.status === "outline").length < 2) {
    console.log("  lên dàn ý 10 chương");
    await planChapters(seriesId, 10);
    return writeNext(seriesId);
  }
  const next = list.find((c) => c.status === "outline")!;
  console.log(`  viết chương ${next.number}: ${next.title}`);
  let r = await writeChapterStep(next.id, "start");
  for (let i = 0; i < 2 && !r.enough; i++) r = await writeChapterStep(next.id, "continue");
  await writeChapterStep(next.id, "finish");
  return next.id;
}

async function main() {
  const failures: string[] = [];
  for (const s of await db().select().from(series).where(eq(series.autopilot, true))) {
    try {
      console.log(`▶ ${s.title}`);
      const pending = await db()
        .select({ id: chapters.id })
        .from(chapters)
        .where(and(eq(chapters.seriesId, s.id), eq(chapters.status, "draft")));
      if (!s.autoApprove && pending.length >= MAX_PENDING) {
        console.log(`  bỏ qua: đã có ${pending.length} chương chờ duyệt`);
        continue;
      }
      const chapterId = await writeNext(s.id);
      if (s.autoApprove) {
        await db().update(chapters).set({ status: "approved", updatedAt: new Date() }).where(eq(chapters.id, chapterId));
        await db().insert(videos).values({ chapterId });
      }
    } catch (e) {
      console.error(e);
      failures.push(`${s.title}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Render mọi video còn trong hàng đợi (do tự duyệt, hoặc web không gọi được Actions).
  for (const v of await db().select().from(videos).where(eq(videos.status, "queued")).orderBy(asc(videos.id))) {
    await renderVideo(v.id).catch((e) => failures.push(`video #${v.id}: ${e instanceof Error ? e.message : e}`));
  }

  if (failures.length) {
    console.error("Lỗi:\n" + failures.join("\n"));
    process.exit(1);
  }
}

main().then(() => process.exit(0));
