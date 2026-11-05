import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let instance: ReturnType<typeof createDb> | undefined;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DATABASE_URL — kết nối Neon trong Vercel → Storage.");
  return drizzle(neon(url), { schema });
}

/** Khởi tạo lười để `next build` không cần DATABASE_URL. */
export function db() {
  instance ??= createDb();
  return instance;
}
