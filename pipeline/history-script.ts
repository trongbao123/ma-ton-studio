// Viết một kịch bản lịch sử (CLI: render.ts "historyscript:<seriesId>"): đề tài kế tiếp → gom hồ sơ → viết nhiều lượt → soát sự thật.
// Dùng khi bộ lịch sử chưa bật autopilot (chưa có phần dựng hình); khi bật, daily.ts tự viết theo cùng luồng writeChapterStep.
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chapters } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { FactCheckFailedError } from "@/lib/story/fact-check";
import { pickChapterToWrite } from "@/lib/story/history";
import { maxContinues } from "@/lib/story/prompts";
import { getSeries, writeChapterStep } from "@/lib/story/service";

/** Soát lại + chốt một kịch bản lịch sử đã viết (vd sau khi sửa tay); còn lỗi → null (đã báo Telegram). */
export async function recheckHistoryScript(chapterId: number): Promise<{ chapterId: number; words: number } | null> {
  await loadSecrets(true);
  try {
    const done = await writeChapterStep(chapterId, "finish");
    console.log(`✔ Soát lại đạt — ${done.words} từ, đã chốt kịch bản`);
    return { chapterId, words: done.words };
  } catch (e) {
    if (!(e instanceof FactCheckFailedError)) throw e;
    console.log(`⚠ ${e.message}`);
    return null;
  }
}

/** Viết trọn kịch bản cho đề tài kế tiếp; lỗi sự thật còn sau soát → null (đã báo Telegram, đề tài "chờ sửa"). */
export async function writeHistoryScript(seriesId: number): Promise<{ chapterId: number; words: number } | null> {
  await loadSecrets(true);
  const s = await getSeries(seriesId);
  const topics = await db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
  const next = pickChapterToWrite(topics);
  if (!next) {
    console.log(`• ${s.title}: không còn đề tài nào để viết`);
    return null;
  }
  console.log(`▶ ${s.title} — đề tài ${next.number}: ${next.title}`);
  try {
    let step = await writeChapterStep(next.id, next.content ? "continue" : "start");
    console.log(`  lượt đầu: ${step.words} từ`);
    for (let i = 0; i < maxContinues(s.targetWords) && !step.enough; i++) {
      step = await writeChapterStep(next.id, "continue");
      console.log(`  viết tiếp: ${step.words} từ`);
    }
    const done = await writeChapterStep(next.id, "finish");
    console.log(`✔ Kịch bản ${done.words} từ — soát sự thật đạt`);
    return { chapterId: next.id, words: done.words };
  } catch (e) {
    if (!(e instanceof FactCheckFailedError)) throw e;
    console.log(`⚠ ${e.message}:`);
    for (const issue of e.issues) console.log(`  • “${issue.quote}” → ${issue.note}`);
    return null;
  }
}
