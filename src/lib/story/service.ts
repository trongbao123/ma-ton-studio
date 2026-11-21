import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, type Chapter, type Series } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { polishOpening, shouldPolishOpening } from "./editor";
import { isLifeStory, lifeIsFinalPart } from "./life";
import { historyIsFinalPart, historyScriptComplete, isHistoryStory, isSensitiveTopic, wikiTitleOf } from "./history";
import { buildDossier, dossierText } from "./dossier";
import { factCheckScript, FactCheckFailedError } from "./fact-check";
import type { Dossier } from "./history-types";
import { escapeHtml, notify } from "@/lib/notify";
import { freshInsights, loadTrends, trendsBrief } from "@/lib/trends";
import {
  bibleSchema,
  biblePrompt,
  chapterPrompt,
  outlinePrompt,
  outlineSchema,
  type RecalledChapter,
  continuePrompt,
  historyContinuePrompt,
  dropRepeatedParagraphs,
  isLongChapter,
  summaryPrompt,
  wordCount,
} from "./prompts";

export async function draftBible(idea: string, genre: string) {
  return textProvider().generateJson({ ...biblePrompt(idea, genre), schema: bibleSchema, temperature: 1, task: "story" });
}

/** Thêm `count` chương ở trạng thái `outline` nối tiếp chương cuối hiện có; trả số chương thực sự đã thêm (lịch sử có thể loại bớt). */
export async function planChapters(seriesId: number, count: number): Promise<number> {
  const s = await getSeries(seriesId);
  const previous = await listChapters(seriesId);
  const { chapters: drafts } = await textProvider().generateJson({
    ...outlinePrompt(s, previous, count, trendsBrief(freshInsights(await loadTrends()))),
    schema: outlineSchema,
    temperature: 0.9,
    task: "story",
  });

  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  // Lịch sử: loại đề tài nhạy cảm chính trị hoặc thiếu dòng "Wikipedia:" trước khi lưu (chủ kênh: "cái gì nhạy cảm quá thì né").
  const kept = isHistoryStory(s) ? drafts.filter((d) => !isSensitiveTopic(`${d.title}\n${d.outline}`) && wikiTitleOf(d.outline) != null) : drafts;
  if (kept.length < drafts.length) console.log(`  loại ${drafts.length - kept.length} đề tài nhạy cảm/thiếu Wikipedia`);
  if (!kept.length) return 0;
  await db()
    .insert(chapters)
    .values(
      kept.map((d, i) => ({
        seriesId,
        number: startAt + i,
        // Model hay tự thêm "Chương N:" vào tiêu đề — UI đã hiển thị số chương.
        title: d.title.replace(/^\s*chương\s*\d+\s*[:.\-–—]\s*/i, ""),
        outline: d.outline,
      })),
    );
  return kept.length;
}

export type WriteMode = "start" | "continue" | "finish";

/**
 * Viết chương theo từng lượt để mỗi request nằm dưới maxDuration (300s) của Vercel.
 * Trình duyệt điều phối: start → continue (tới khi `enough`, tối đa `maxContinues`: 2 lần, chương dài 5 lần) → finish (tóm tắt, chuyển chờ duyệt).
 */
export async function writeChapterStep(chapterId: number, mode: WriteMode) {
  let chapter = await getChapter(chapterId);
  if (chapter.status === "approved") throw new Error("Chương đã duyệt — bỏ duyệt trước khi viết lại.");
  const s = await getSeries(chapter.seriesId);
  const history = isHistoryStory(s);
  if (history && !chapter.dossier) chapter = { ...chapter, dossier: await ensureDossier(chapter) };
  // Lượt chốt trước lỗi (soát hỏng giữa chừng) mà kịch bản đã viết tới kết: chỉ chốt lại, không viết tiếp đè sau đoạn kết.
  if (history && mode === "continue" && historyScriptComplete(wordCount(chapter.content), s.targetWords))
    return { words: wordCount(chapter.content), enough: true, warning: null };
  const ai = textProvider();
  let content = chapter.content;
  let warning: string | null = null;

  if (mode === "finish" && history) {
    content = await factCheckChapter(chapter, s.title, content);
  }
  if (mode === "finish") {
    const summary = await ai.generateText({ ...summaryPrompt(chapter, content), temperature: 0.3, tier: "cheap", task: "summary" });
    await db().update(chapters).set({ summary, status: "draft", updatedAt: new Date() }).where(eq(chapters.id, chapterId));
  } else {
    const base = chapterPrompt(s, await previousChapters(chapter), chapter, { partial: isLongChapter(s.targetWords) });
    const part = await ai.generateText({
      ...partPrompt({ mode, base, content, s }),
      maxOutputTokens: 16000,
      temperature: 0.9,
      task: "story",
    });
    content = mode === "start" ? part : `${content}\n\n${dropRepeatedParagraphs(content, part)}`;
    const save = (text: string) => db().update(chapters).set({ content: text, summary: "", status: "outline", updatedAt: new Date() }).where(eq(chapters.id, chapterId));
    // Lưu ngay bản vừa viết: bước chấm phía sau lỗi/bị cắt cũng không mất lượt viết 16k token.
    await save(content);
    // Biên tập mở đầu chấm theo luật tiên hiệp (bàn tay vàng…) — chuyện đời có nhịp riêng nên bỏ qua.
    if (mode === "start" && shouldPolishOpening() && !isLifeStory(s) && !history) {
      // Biên tập viên AI chấm 300 từ đầu ngay lượt đầu — viết lại lúc này rẻ nhất, trước khi tốn các lượt viết tiếp và giọng đọc.
      const polished = await polishOpening(content, base, ai);
      warning = polished.warning;
      if (polished.content !== content) await save((content = polished.content));
    }
  }
  const words = wordCount(content);
  if (history) {
    // Như chuyện đời: xong khi vừa viết lượt KẾT (lượt cuối chốt theo số từ còn thiếu trước lượt đó).
    return { words, enough: mode === "continue" && historyIsFinalPart(wordCount(chapter.content), s.targetWords), warning };
  }
  if (isLifeStory(s)) {
    // Chuyện đời ~1 tiếng: xong khi vừa viết lượt KẾT (dù dài/ngắn — viết thêm là dán đoạn sau đoạn kết). Lượt giữa viết dư
    // chữ vẫn chưa xong vì truyện chưa kết; lượt sau sẽ là lượt KẾT.
    const ended = mode === "continue" && lifeIsFinalPart(wordCount(chapter.content), s.targetWords);
    return { words, enough: ended, warning };
  }
  return { words, enough: words >= s.targetWords * 0.8, warning };
}

type PartRequest = { mode: WriteMode; base: { system: string; prompt: string }; content: string; s: Series };

/** Prompt của một lượt viết: lượt đầu dùng prompt gốc; lượt tiếp theo thể loại (lịch sử / chuyện đời / tiên hiệp). */
function partPrompt({ mode, base, content, s }: PartRequest) {
  if (mode === "start") return base;
  if (isHistoryStory(s)) return historyContinuePrompt(base, content, s.targetWords);
  return continuePrompt(base, content, s.targetWords, isLifeStory(s));
}

/** Hồ sơ tư liệu của đề tài lịch sử: gom từ Wikipedia theo dòng "Wikipedia:" trong dàn ý rồi lưu (chỉ gom một lần). */
async function ensureDossier(chapter: Chapter): Promise<Dossier> {
  const wiki = wikiTitleOf(chapter.outline);
  if (!wiki) throw new Error(`Đề tài "${chapter.title}" thiếu dòng "Wikipedia: <tiêu đề bài tiếng Anh>" trong dàn ý.`);
  const dossier = await buildDossier(wiki);
  await db().update(chapters).set({ dossier, updatedAt: new Date() }).where(eq(chapters.id, chapter.id));
  return dossier;
}

/**
 * Soát sự thật kịch bản lịch sử trước khi chốt. Đạt → trả kịch bản đã vá. Còn lỗi → lưu bản vá + lỗi ("chờ sửa"),
 * báo Telegram, ném FactCheckFailedError (lượt viết tự động sẽ nhảy sang đề tài kế).
 */
async function factCheckChapter(chapter: Chapter, seriesTitle: string, content: string): Promise<string> {
  const checked = await factCheckScript(textProvider(), content, dossierText(chapter.dossier!));
  await db()
    .update(chapters)
    .set({ content: checked.script, factIssues: checked.issues.length ? checked.issues : null, updatedAt: new Date() })
    .where(eq(chapters.id, chapter.id));
  if (!checked.issues.length) return checked.script;
  const sample = checked.issues.slice(0, 5).map((i) => `• “${escapeHtml(i.quote.slice(0, 80))}” → ${escapeHtml(i.note.slice(0, 120))}`).join("\n");
  await notify(`⚠️ <b>${escapeHtml(seriesTitle)}</b> — kịch bản "${escapeHtml(chapter.title)}" còn ${checked.issues.length} lỗi sự thật sau soát, CHƯA render (chờ sửa):\n${sample}`);
  throw new FactCheckFailedError(`Kịch bản "${chapter.title}" còn ${checked.issues.length} lỗi sự thật`, checked.issues);
}

/** Prompt đầy đủ để người dùng tự dán vào ChatGPT/Claude web nếu muốn. */
export async function manualPrompt(chapter: Chapter) {
  const [s, previous] = await Promise.all([getSeries(chapter.seriesId), previousChapters(chapter)]);
  return manualPromptOf(s, previous, chapter);
}

/** Ghép prompt thủ công từ dữ liệu đã nạp sẵn (trang chương nạp song song với các truy vấn khác). */
export function manualPromptOf(s: Series, previous: RecalledChapter[], chapter: Chapter) {
  const p = chapterPrompt(s, previous, chapter);
  return `${p.system}\n\n${p.prompt}`;
}

/** Chỉ số, tiêu đề, tóm tắt các chương trước — prompt chỉ cần bấy nhiêu (nội dung đầy đủ ~15KB/chương không dùng tới). */
export function previousChapters(chapter: Pick<Chapter, "seriesId" | "number">) {
  return db()
    .select({ number: chapters.number, title: chapters.title, summary: chapters.summary })
    .from(chapters)
    .where(and(eq(chapters.seriesId, chapter.seriesId), lt(chapters.number, chapter.number)))
    .orderBy(asc(chapters.number));
}

export async function getSeries(id: number) {
  const [row] = await db().select().from(series).where(eq(series.id, id));
  if (!row) throw new Error(`Không tìm thấy truyện #${id}.`);
  return row;
}

export async function getChapter(id: number): Promise<Chapter> {
  const [row] = await db().select().from(chapters).where(eq(chapters.id, id));
  if (!row) throw new Error(`Không tìm thấy chương #${id}.`);
  return row;
}

/** Danh sách chương gọn cho trang truyện (không kéo nội dung / dàn ý / tóm tắt của từng chương). */
export function listChapterRows(seriesId: number) {
  return db()
    .select({ id: chapters.id, number: chapters.number, title: chapters.title, status: chapters.status })
    .from(chapters)
    .where(eq(chapters.seriesId, seriesId))
    .orderBy(asc(chapters.number));
}

export function listChapters(seriesId: number) {
  return db().select().from(chapters).where(eq(chapters.seriesId, seriesId)).orderBy(asc(chapters.number));
}
