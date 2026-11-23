// Chép TOÀN BỘ dữ liệu Neon cũ sang DB hiện tại (Supabase). Neon free hết hạn mức 23/11/2026 → khoá cả đọc;
// chạy khi Neon mở lại (nâng gói tạm hoặc sang kỳ mới). Chạy: node scripts/migrate-neon.mjs [--dry]
// Nguồn: NEON_DATABASE_URL, đích: DB_URL ?? DATABASE_URL (đọc .env.local nếu có). Đích bị XOÁ SẠCH rồi chép lại (giữ id).
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

if (existsSync(".env.local")) for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const SRC = process.env.NEON_DATABASE_URL;
const DST = process.env.DB_URL ?? process.env.DATABASE_URL;
if (!SRC || !DST) throw new Error("Thiếu NEON_DATABASE_URL hoặc DB_URL/DATABASE_URL");
if (SRC === DST) throw new Error("Nguồn và đích trùng nhau");
const dry = process.argv.includes("--dry");
const ssl = (u) => (u.includes("localhost") || u.includes("127.0.0.1") ? false : "require");
const src = postgres(SRC, { max: 1, ssl: ssl(SRC), prepare: false });
const dst = postgres(DST, { max: 1, ssl: ssl(DST), prepare: false });

// Thứ tự theo khoá ngoại: series → chapters → videos; còn lại độc lập.
const TABLES = ["series", "chapters", "videos", "app_settings", "ai_usage", "places"];
const BATCH = 200;

try {
  const counts = {};
  for (const t of TABLES) counts[t] = (await src`select count(*)::int as n from ${src(t)}`)[0].n;
  console.log("Nguồn (Neon):", counts);
  if (dry) process.exit(0);

  await dst.begin(async (tx) => {
    await tx.unsafe(`truncate ${TABLES.map((t) => `"${t}"`).join(", ")} restart identity cascade`);
    for (const t of TABLES) {
      const jsonCols = new Set(
        (await tx`select column_name from information_schema.columns where table_schema='public' and table_name=${t} and data_type in ('json','jsonb')`).map((r) => r.column_name),
      );
      let copied = 0;
      for (let offset = 0; ; offset += BATCH) {
        const rows = await src`select * from ${src(t)} order by 1 limit ${BATCH} offset ${offset}`;
        if (!rows.length) break;
        const fixed = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, jsonCols.has(k) && v != null ? tx.json(v) : v])));
        await tx`insert into ${tx(t)} ${tx(fixed)}`;
        copied += rows.length;
      }
      // Bảng có cột id serial: đặt lại sequence sau khi chèn id cũ.
      const hasId = (await tx`select 1 from information_schema.columns where table_schema='public' and table_name=${t} and column_name='id'`).length > 0;
      const seq = hasId ? (await tx`select pg_get_serial_sequence(${t}, 'id') as s`)[0]?.s : null;
      if (seq) await tx.unsafe(`select setval('${seq}', coalesce((select max(id) from "${t}"), 0) + 1, false)`);
      console.log(`✔ ${t}: ${copied}/${counts[t]}`);
      if (copied !== counts[t]) throw new Error(`${t} chép thiếu (${copied}/${counts[t]}) — huỷ toàn bộ`);
    }
  });
  console.log("✔ Xong — đích đã có toàn bộ dữ liệu cũ.");
} finally {
  await src.end({ timeout: 2 });
  await dst.end({ timeout: 2 });
}
