import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

let instance: ReturnType<typeof createDb> | undefined;

/**
 * Postgres chuẩn (Supabase / Neon / bất kỳ) qua postgres-js. 23/11/2026: Neon free hết hạn mức (402, khoá cả compute)
 * → chuyển Supabase free; driver chung để sau này chép dữ liệu Neon sang mà không đổi code.
 * `prepare: false`: Supabase pooler chế độ transaction (cổng 6543) không hỗ trợ prepared statement.
 * Serverless (Vercel) mỗi lần gọi một kết nối ngắn → max nhỏ, đóng khi rảnh.
 */
function createDb() {
  // DB_URL (Supabase) ưu tiên: DATABASE_URL trên Vercel do tích hợp Neon quản lý, không xoá/đổi được bằng CLI.
  const url = process.env.DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DATABASE_URL — chuỗi kết nối Postgres (Supabase → Project Settings → Database → Connection pooling).");
  const client = postgres(url, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5), idle_timeout: 20, connect_timeout: 30, ssl: url.includes("localhost") ? false : "require" });
  return drizzle(client, { schema });
}

/** Khởi tạo lười để `next build` không cần DATABASE_URL. */
export function db() {
  instance ??= createDb();
  return instance;
}
