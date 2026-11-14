// Tạo bộ truyện mới theo mô-típ (CLI: render.ts "newseries:trungsinh,xuyenkhong,hethong") và in danh sách bộ ("series").
// Chạy trên runner (có DATABASE_URL + gói AI). Bộ cùng thể loại đã có thì bỏ qua → chạy lại không tạo trùng.
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { draftBible } from "@/lib/story/service";
import { seriesSettingsFrom, tropeOf } from "@/lib/story/tropes";
import { escapeHtml, notify } from "@/lib/notify";

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
    const [row] = await db().insert(series).values({ ...draft, genre: t.genre, ...seriesSettingsFrom(template) }).returning({ id: series.id });
    console.log(`✔ #${row.id} ${draft.title}\n  ${draft.premise}`);
    await notify(`🆕 Bộ mới <b>${escapeHtml(draft.title)}</b> (${escapeHtml(t.genre)}) — #${row.id}, đã bật tự chạy.\n${escapeHtml(draft.premise.slice(0, 400))}`);
  }
  await listSeries();
}

export async function listSeries() {
  await loadSecrets(true);
  const rows = await db()
    .select({
      id: series.id, title: series.title, genre: series.genre, autopilot: series.autopilot, perDay: series.chaptersPerDay,
      episode: series.episodeChapters, voice: series.ttsVoice, chapters: sql<number>`(select count(*)::int from ${chapters} where ${eq(chapters.seriesId, series.id)})`,
    })
    .from(series)
    .orderBy(asc(series.id));
  console.table(rows);
}
