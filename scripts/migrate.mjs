// Chạy trước `next build` trên Vercel. Không có DATABASE_URL (build ở máy/CI) thì bỏ qua.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] Không có DATABASE_URL — bỏ qua migration.");
} else {
  await migrate(drizzle(neon(url)), { migrationsFolder: "./drizzle" });
  console.log("[migrate] Xong.");
}
