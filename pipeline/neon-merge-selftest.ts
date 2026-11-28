// Tự kiểm gộp Neon → Supabase trên 2 Postgres rỗng (workflow neon-merge, mode selftest): migrate cả 2, nạp dữ liệu mẫu có id TRÙNG
// nhau như thực tế (Supabase đếm lại từ 1 ngày 23/11/2026), gộp, rồi soát kết quả. Thoát mã 1 nếu sai.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { mergeNeon } from "./migrate-neon";
import { ARCHIVE_NUMBER_OFFSET } from "./neon-merge";

const SRC = process.env.SELFTEST_SRC_URL ?? "postgres://postgres:postgres@localhost:5433/postgres";
const DST = process.env.SELFTEST_DST_URL ?? "postgres://postgres:postgres@localhost:5434/postgres";

async function prepare(url: string) {
  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  return client;
}

/** Neon cũ: bộ chuyện đời #1 (trùng kênh với Supabase) + bộ tu tiên #2; chương/video id 1..; 1 bản gộp; 1 video dở. */
async function seedNeon(sql: postgres.Sql) {
  await sql`insert into series (id, title, genre, premise, bible, channel) values
    (1, 'Chuyện Đời (cũ)', 'Chuyện đời', 'p', 'b', 'chuyen-doi'), (2, 'Thôn Phệ', 'Tiên hiệp', 'p', 'b', 'main')`;
  await sql`insert into chapters (id, series_id, number, title, outline, status) values
    (1, 1, 1, 'Mẹ Ký Giấy Vay Nặng Lãi', 'o', 'approved'), (2, 1, 2, 'Truyện Cũ Riêng', 'o', 'approved'), (3, 2, 1, 'Chương 1', 'o', 'approved')`;
  await sql`insert into videos (id, chapter_id, status, youtube_video_id, meta) values
    (1, 1, 'published', 'YT_OLD_1', ${sql.json({ title: "a" })}),
    (2, 2, 'queued', null, null),
    (3, 3, 'published', 'YT_OLD_3', ${sql.json({ title: "gộp", compilation: { seriesId: 2, from: 1, to: 1, videoIds: [3] } })})`;
  await sql`insert into app_settings (key, value) values
    ('hero_ref_2', ${sql.json({ jpg: "hero" })}), ('youtube:chuyen-doi', ${sql.json({ token: "OLD" })}), ('yt_playlists', ${sql.json({ "1": "PL_OLD1", "2": "PL_OLD2" })})`;
  await sql`insert into ai_usage (day, model, calls) values ('2026-11-20', 'm', 5)`;
}

/** Supabase mới: bộ chuyện đời #1 với chương trùng tên chương cũ; id video 1 đã dùng; token YouTube mới. */
async function seedSupabase(sql: postgres.Sql) {
  await sql`insert into series (id, title, genre, premise, bible, channel, autopilot) values (1, 'Chuyện Đời Lắng Đọng', 'Chuyện đời', 'p', 'b', 'chuyen-doi', true)`;
  await sql`insert into chapters (id, series_id, number, title, outline) values (1, 1, 1, 'Mẹ ký giấy vay nặng lãi', 'o'), (2, 1, 2, 'Truyện Mới', 'o')`;
  await sql`insert into videos (id, chapter_id, status) values (1, 2, 'queued')`;
  await sql`insert into app_settings (key, value) values ('youtube:chuyen-doi', ${sql.json({ token: "NEW" })}), ('yt_playlists', ${sql.json({ "1": "PL_NEW1" })})`;
  await sql`select setval(pg_get_serial_sequence('series','id'), 10000, false), setval(pg_get_serial_sequence('chapters','id'), 10000, false), setval(pg_get_serial_sequence('videos','id'), 10000, false)`;
}

const failures: string[] = [];
const expectThat = (ok: boolean, what: string) => {
  console.log(`${ok ? "✔" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

async function main() {
  const src = await prepare(SRC);
  const dst = await prepare(DST);
  await seedNeon(src);
  await seedSupabase(dst);

  await mergeNeon(SRC, DST, true);
  const [{ n: afterDry }] = await dst`select count(*)::int as n from videos`;
  expectThat(afterDry === 1, "--dry không đổi gì trên Supabase");

  await mergeNeon(SRC, DST, false);
  const series = await dst`select id, title, autopilot from series order by id`;
  expectThat(series.length === 2 && series.some((s) => s.title === "Thôn Phệ" && s.id >= 10000 && !s.autopilot), "bộ chuyện đời gộp vào #1; bộ tu tiên thêm mới id ≥ 10000, tắt autopilot");
  const chapters = await dst`select id, series_id, number, title from chapters order by id`;
  expectThat(chapters.length === 4, `chương: 2 mới + 1 cũ riêng + 1 tu tiên (trùng tên thì dùng lại) — thực tế ${chapters.length}`);
  expectThat(chapters.some((c) => c.title === "Truyện Cũ Riêng" && c.series_id === 1 && c.number === ARCHIVE_NUMBER_OFFSET + 2), "chương cũ của bộ gộp mang số âm");
  const videos = await dst`select id, chapter_id, status, youtube_video_id, meta from videos order by id`;
  expectThat(videos.length === 4, `video: 1 mới + 3 cũ — thực tế ${videos.length}`);
  expectThat(videos.filter((v) => v.youtube_video_id).every((v) => v.id >= 10000), "video cũ nhận id mới ≥ 10000");
  expectThat(videos.some((v) => v.youtube_video_id === "YT_OLD_1" && v.chapter_id === 1), "video của chương trùng tên gắn vào chương đang có");
  expectThat(videos.some((v) => v.status === "failed" && v.id >= 10000), "video cũ dở dang → failed (không tự render)");
  const compiled = videos.find((v) => v.youtube_video_id === "YT_OLD_3");
  const own = compiled?.id as number;
  expectThat(compiled?.meta?.compilation?.videoIds?.[0] === own && compiled?.meta?.compilation?.seriesId >= 10000, "id trong meta bản gộp đổi sang id mới");
  const settings = Object.fromEntries((await dst`select key, value from app_settings`).map((r) => [r.key, r.value]));
  expectThat(settings["youtube:chuyen-doi"]?.token === "NEW", "cài đặt mới (token YouTube) giữ nguyên");
  expectThat(Object.keys(settings).some((k) => /^hero_ref_1\d{4}$/.test(k)), "hero_ref đổi theo id bộ mới");
  expectThat(settings.yt_playlists?.["1"] === "PL_NEW1" && Object.values(settings.yt_playlists).includes("PL_OLD2"), "yt_playlists gộp, giá trị mới thắng");

  await src.end();
  await dst.end();
  if (failures.length) {
    console.error(`✗ ${failures.length} kiểm tra hỏng`);
    process.exit(1);
  }
  console.log("✔ Tự kiểm gộp Neon đạt");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
