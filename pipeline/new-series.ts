// Tạo bộ truyện mới theo mô-típ (CLI: render.ts "newseries:trungsinh,xuyenkhong,hethong") và in danh sách bộ ("series").
// Chạy trên runner (có DATABASE_URL + gói AI). Bộ cùng thể loại đã có thì bỏ qua → chạy lại không tạo trùng.
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { draftBible } from "@/lib/story/service";
import { seriesSettingsFrom, tropeOf } from "@/lib/story/tropes";
import { FIRST_PERSON_STYLE } from "@/lib/story/prompts";
import { escapeHtml, notify } from "@/lib/notify";
import {
  LIFE_BIBLE, LIFE_GENRE, LIFE_PILOT, LIFE_PREMISE, LIFE_STYLE, LIFE_TARGET_WORDS, LIFE_TTS_VOICE, LIFE_VOICE_STYLE, pilotOutline,
} from "@/lib/story/life";
import { HISTORY_BIBLE, HISTORY_GENRE, HISTORY_PILOT, HISTORY_PREMISE, HISTORY_STYLE, HISTORY_TARGET_WORDS, topicOutline } from "@/lib/story/history";

export async function newSeries(keys: string[]) {
  await loadSecrets(true);
  const all = await db().select().from(series).orderBy(asc(series.id));
  // Mẫu: bộ autopilot chạy chế độ tập (đang lên kênh) — bộ mới đi theo đúng nhịp đó.
  const template = all.find((s) => s.autopilot && s.episodeChapters > 0) ?? all.find((s) => s.autopilot);
  console.log(`Mẫu cấu hình: ${template ? `#${template.id} ${template.title}` : "(không có — dùng mặc định)"}`);
  for (const key of keys) {
    const t = tropeOf(key);
    const dup = all.find((s) => s.genre === t.genre);
    if (dup) {
      console.log(`• ${t.genre}: đã có #${dup.id} ${dup.title} — bỏ qua`);
      continue;
    }
    console.log(`▶ ${t.genre}: viết story bible…`);
    const draft = await draftBible(t.idea, t.genre);
    const [row] = await db()
      .insert(series)
      .values({ ...draft, style: FIRST_PERSON_STYLE, genre: t.genre, ...seriesSettingsFrom(template) })
      .returning({ id: series.id });
    console.log(`✔ #${row.id} ${draft.title}\n  ${draft.premise}`);
    await notify(`🆕 Bộ mới <b>${escapeHtml(draft.title)}</b> (${escapeHtml(t.genre)}) — #${row.id}, đã bật tự chạy.\n${escapeHtml(draft.premise.slice(0, 400))}`);
  }
  await listSeries();
}

/**
 * Kênh chuyện đời (CLI: render.ts "newlife" hoặc "newlife:<khoá kênh>"): 1 "bộ" = cả kênh, mỗi chương một truyện độc lập đăng riêng
 * (episodeChapters = 0), nạp sẵn 10 truyện thử nghiệm theo đúng thứ tự kế hoạch. Đã có bộ chuyện đời trên kênh đó thì bỏ qua.
 */
export async function newLifeSeries(channel = "chuyen-doi") {
  if (!/^[a-z0-9-]{1,24}$/.test(channel)) throw new Error(`Khoá kênh không hợp lệ: ${channel}`);
  await loadSecrets(true);
  const [dup] = await db().select().from(series).where(sql`${series.genre} = ${LIFE_GENRE} and ${series.channel} = ${channel}`);
  if (dup) {
    console.log(`• Kênh ${channel} đã có bộ chuyện đời #${dup.id} ${dup.title} — bỏ qua`);
    return listSeries();
  }
  const [row] = await db()
    .insert(series)
    .values({
      title: "Chuyện Đời Lắng Đọng", genre: LIFE_GENRE, premise: LIFE_PREMISE, bible: LIFE_BIBLE, style: LIFE_STYLE, channel,
      targetWords: LIFE_TARGET_WORDS, autopilot: true, autoApprove: true, chaptersPerDay: 1, episodeChapters: 0,
      ttsVoice: LIFE_TTS_VOICE, voiceStyle: LIFE_VOICE_STYLE, makeShort: false, autoPublish: true,
    })
    .returning({ id: series.id });
  await db()
    .insert(chapters)
    .values(LIFE_PILOT.map((p, i) => ({ seriesId: row.id, number: i + 1, title: p.title, outline: pilotOutline(p) })));
  console.log(`✔ #${row.id} Chuyện Đời Lắng Đọng (kênh ${channel}) + ${LIFE_PILOT.length} truyện thử nghiệm`);
  await notify(`🆕 Kênh <b>Chuyện Đời Lắng Đọng</b> — bộ #${row.id}, đã nạp ${LIFE_PILOT.length} truyện, bật tự chạy (3 ngày/truyện).`);
  await listSeries();
}

/**
 * Kênh lịch sử (CLI: render.ts "newhistory" hoặc "newhistory:<khoá kênh>"): 1 bộ = cả kênh, mỗi chương một video tài liệu độc lập,
 * nạp sẵn 20 đề tài. autopilot TẮT cho tới khi phần dựng hình (Kế hoạch 3) xong — viết kịch bản bằng "historyscript:<id>".
 */
export async function newHistorySeries(channel = "lich-su") {
  if (!/^[a-z0-9-]{1,24}$/.test(channel)) throw new Error(`Khoá kênh không hợp lệ: ${channel}`);
  await loadSecrets(true);
  const [dup] = await db().select().from(series).where(sql`${series.genre} = ${HISTORY_GENRE} and ${series.channel} = ${channel}`);
  if (dup) {
    console.log(`• Kênh ${channel} đã có bộ lịch sử #${dup.id} ${dup.title} — bỏ qua`);
    return listSeries();
  }
  const [row] = await db()
    .insert(series)
    .values({
      title: "Sử Ký Kể Chuyện", genre: HISTORY_GENRE, premise: HISTORY_PREMISE, bible: HISTORY_BIBLE, style: HISTORY_STYLE, channel,
      targetWords: HISTORY_TARGET_WORDS, autopilot: false, autoApprove: true, chaptersPerDay: 1, episodeChapters: 0,
      makeShort: false, autoPublish: true,
    })
    .returning({ id: series.id });
  await db()
    .insert(chapters)
    .values(HISTORY_PILOT.map((t, i) => ({ seriesId: row.id, number: i + 1, title: t.title, outline: topicOutline(t) })));
  console.log(`✔ #${row.id} Sử Ký Kể Chuyện (kênh ${channel}) + ${HISTORY_PILOT.length} đề tài`);
  await notify(`🆕 Kênh <b>Sử Ký Kể Chuyện</b> — bộ #${row.id}, đã nạp ${HISTORY_PILOT.length} đề tài (chưa tự chạy, chờ phần dựng hình).`);
  await listSeries();
}

/** Đổi ngôi kể sang "Ta" (CLI: render.ts "pov:5,6,7"). Chương đã viết giữ nguyên — chỉ áp từ chương viết sau. */
export async function firstPerson(ids: number[]) {
  await loadSecrets(true);
  for (const id of ids) {
    const done = await db().select({ n: sql<number>`count(*)::int` }).from(chapters).where(sql`${chapters.seriesId} = ${id} and ${chapters.content} <> ''`);
    await db().update(series).set({ style: FIRST_PERSON_STYLE }).where(eq(series.id, id));
    console.log(`✔ #${id}: kể ngôi "Ta"${done[0]?.n ? ` (đã có ${done[0].n} chương viết theo ngôi cũ — giữ nguyên)` : ""}`);
  }
  await listSeries();
}

export async function listSeries() {
  await loadSecrets(true);
  const rows = await db()
    .select({
      id: series.id, title: series.title, genre: series.genre, channel: series.channel, autopilot: series.autopilot, perDay: series.chaptersPerDay,
      episode: series.episodeChapters, voice: series.ttsVoice, chapters: sql<number>`(select count(*)::int from ${chapters} where ${eq(chapters.seriesId, series.id)})`,
    })
    .from(series)
    .orderBy(asc(series.id));
  console.table(rows);
}

/** Lệnh CLI về bộ truyện (render.ts chuyển sang): trả promise của lệnh khớp, không khớp thì null. */
export function seriesCommand(arg: string): Promise<unknown> | null {
  if (arg.startsWith("newseries:")) return newSeries(arg.slice(10).split(","));
  if (arg === "newlife" || arg.startsWith("newlife:")) return newLifeSeries(arg.slice(8) || undefined);
  if (arg === "newhistory" || arg.startsWith("newhistory:")) return newHistorySeries(arg.slice(11) || undefined);
  if (arg.startsWith("historyscript:")) return import("./history-script").then((x) => x.writeHistoryScript(Number(arg.slice(14))));
  // Soát lại kịch bản lịch sử (sau khi chủ kênh sửa tay đoạn sai) rồi chốt — đạt thì gỡ cờ "chờ sửa".
  if (arg.startsWith("factcheck:")) return import("./history-script").then((x) => x.recheckHistoryScript(Number(arg.slice(10))));
  if (arg.startsWith("pov:")) return firstPerson(arg.slice(4).split(",").map(Number));
  if (arg === "series") return listSeries();
  return null;
}
