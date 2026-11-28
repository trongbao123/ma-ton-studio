// GỘP dữ liệu Neon cũ vào Supabase đang chạy (Neon free khoá từ 23/11/2026 — chạy khi Neon mở lại).
// Chạy: pnpm db:migrate-neon [--dry]   Nguồn: NEON_DATABASE_URL · Đích: DB_URL ?? DATABASE_URL (đọc .env.local nếu có).
// KHÔNG xoá, KHÔNG ghi đè: dòng cũ nhận id mới (sequence ≥ 10000, không trùng release `video-<id>` cũ của dòng MỚI), một transaction.
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import type { VideoMeta } from "@/db/schema";
import { importedVideoStatus, planChapter, planSeries, remapSetting, remapVideoMeta, type ChapterRow, type IdMaps, type SeriesRow } from "./neon-merge";

type Row = Record<string, unknown>;
type Sql = postgres.Sql | postgres.TransactionSql;

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
}

const sslFor = (url: string) => (url.includes("localhost") || url.includes("127.0.0.1") ? false : "require");

/** Bỏ `id` (để sequence cấp id mới) và bọc cột json/jsonb cho postgres-js. */
function insertable(tx: Sql, row: Row, jsonCols: Set<string>): Row {
  return Object.fromEntries(
    Object.entries(row)
      .filter(([k]) => k !== "id")
      .map(([k, v]) => [k, jsonCols.has(k) && v != null ? tx.json(v as postgres.JSONValue) : v]),
  );
}

async function jsonColumns(tx: Sql, table: string) {
  const rows = await tx`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table} and data_type in ('json','jsonb')`;
  return new Set(rows.map((r) => r.column_name as string));
}

/** Gộp Neon (`srcUrl`) vào Supabase (`dstUrl`) trong một transaction; `dry` = in kế hoạch rồi huỷ. */
export async function mergeNeon(srcUrl: string, dstUrl: string, dry: boolean) {
  if (srcUrl === dstUrl) throw new Error("Nguồn và đích trùng nhau");
  const src = postgres(srcUrl, { max: 1, ssl: sslFor(srcUrl), prepare: false });
  const dst = postgres(dstUrl, { max: 1, ssl: sslFor(dstUrl), prepare: false });
  try {
    const [oldSeries, oldChapters, oldVideos, oldSettings, oldUsage, oldPlaces] = await Promise.all([
      src`select * from series order by id`, src`select * from chapters order by id`, src`select * from videos order by id`,
      src`select * from app_settings`, src`select * from ai_usage`, src`select * from places`,
    ]);
    console.log(`Neon: ${oldSeries.length} bộ, ${oldChapters.length} chương, ${oldVideos.length} video, ${oldSettings.length} cài đặt, ${oldUsage.length} ai_usage, ${oldPlaces.length} địa danh`);

    await dst.begin(async (tx) => {
      const curSeries = (await tx`select id, genre, channel, title from series`) as unknown as SeriesRow[];
      const curChapters = (await tx`select id, series_id as "seriesId", number, title from chapters`) as unknown as ChapterRow[];
      const seriesPlan = planSeries(oldSeries as unknown as SeriesRow[], curSeries);
      const maps: IdMaps = { series: new Map(), chapters: new Map(), videos: new Map() };
      const json = { series: await jsonColumns(tx, "series"), chapters: await jsonColumns(tx, "chapters"), videos: await jsonColumns(tx, "videos") };

      for (const s of oldSeries) {
        const target = seriesPlan.get(s.id as number);
        if (target != null) {
          maps.series.set(s.id as number, target);
          console.log(`  bộ cũ #${s.id} ${s.title} → gộp vào bộ #${target}`);
          continue;
        }
        // Bộ không còn chạy (kênh tu tiên cũ…): thêm vào ở trạng thái TẮT tự chạy.
        const [row] = await tx`insert into series ${tx(insertable(tx, { ...s, autopilot: false }, json.series))} returning id`;
        maps.series.set(s.id as number, row.id as number);
        console.log(`  bộ cũ #${s.id} ${s.title} → thêm mới #${row.id} (tắt autopilot)`);
      }

      const mergedSeries = new Set(oldSeries.filter((s) => seriesPlan.get(s.id as number) != null).map((s) => s.id as number));
      let reused = 0;
      for (const c of oldChapters) {
        const targetSeries = maps.series.get(c.series_id as number)!;
        const plan = planChapter({ id: c.id as number, seriesId: c.series_id as number, number: c.number as number, title: c.title as string }, targetSeries, mergedSeries.has(c.series_id as number), curChapters);
        if (plan.kind === "reuse") {
          maps.chapters.set(c.id as number, plan.targetId);
          reused++;
          continue;
        }
        const [row] = await tx`insert into chapters ${tx(insertable(tx, { ...c, series_id: plan.seriesId, number: plan.number }, json.chapters))} returning id`;
        maps.chapters.set(c.id as number, row.id as number);
      }
      console.log(`  chương: ${oldChapters.length - reused} thêm mới, ${reused} trùng tên → dùng chương đang có`);

      // Lượt 1 chèn video để có bản đồ id; lượt 2 đổi id trong meta (bản gộp trỏ tới video khác).
      for (const v of oldVideos) {
        const { status, error } = importedVideoStatus(v.status as string);
        const [row] = await tx`insert into videos ${tx(insertable(tx, { ...v, chapter_id: maps.chapters.get(v.chapter_id as number)!, status, error: error ?? v.error }, json.videos))} returning id`;
        maps.videos.set(v.id as number, row.id as number);
      }
      for (const v of oldVideos) {
        const meta = remapVideoMeta(v.meta as VideoMeta | null, maps);
        if (meta) await tx`update videos set meta = ${tx.json(meta as unknown as postgres.JSONValue)} where id = ${maps.videos.get(v.id as number)!}`;
      }
      console.log(`  video: ${oldVideos.length} thêm mới (dở dang → failed, không tự render)`);

      let settings = 0;
      for (const s of oldSettings) {
        const [cur] = await tx`select value from app_settings where key = ${s.key as string}`;
        const plan = remapSetting(s.key as string, s.value, maps.series, cur?.value ?? null);
        if (!plan) continue;
        const settingJson = tx.json(plan.value as postgres.JSONValue);
        const done = plan.overwrite
          ? await tx`insert into app_settings (key, value) values (${plan.key}, ${settingJson}) on conflict (key) do update set value = excluded.value returning key`
          : await tx`insert into app_settings (key, value) values (${plan.key}, ${settingJson}) on conflict (key) do nothing returning key`;
        settings += done.length;
      }
      for (const u of oldUsage) await tx`insert into ai_usage ${tx(u)} on conflict (day, model) do nothing`;
      for (const p of oldPlaces) await tx`insert into places ${tx(p)} on conflict (query) do nothing`;
      console.log(`  cài đặt: ${settings} ghi (cài đặt mới luôn được giữ) · ai_usage/địa danh: thêm phần còn thiếu`);

      if (dry) throw new DryRun();
    });
    console.log("✔ Đã gộp xong dữ liệu Neon vào Supabase.");
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
    console.log("(--dry) Chạy thử xong — đã HUỶ transaction, Supabase không đổi.");
  } finally {
    await src.end({ timeout: 2 });
    await dst.end({ timeout: 2 });
  }
}

/** Ném ra cuối transaction ở chế độ --dry để huỷ mọi thay đổi sau khi in kế hoạch. */
class DryRun extends Error {}

async function main() {
  loadEnvLocal();
  const srcUrl = process.env.NEON_DATABASE_URL;
  const dstUrl = process.env.DB_URL ?? process.env.DATABASE_URL;
  if (!srcUrl || !dstUrl) throw new Error("Thiếu NEON_DATABASE_URL hoặc DB_URL/DATABASE_URL");
  await mergeNeon(srcUrl, dstUrl, process.argv.includes("--dry"));
}

// CLI: tsx pipeline/migrate-neon.ts [--dry] — import (selftest) không tự chạy.
if (process.argv[1]?.endsWith("migrate-neon.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
