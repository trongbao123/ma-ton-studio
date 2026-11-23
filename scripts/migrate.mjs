// Chạy trước `next build` trên Vercel. Không có DATABASE_URL (build ở máy/CI) thì bỏ qua.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("[migrate] Không có DATABASE_URL — bỏ qua migration.");
} else {
  const client = postgres(url, { prepare: false, max: 1, ssl: url.includes("localhost") ? false : "require" });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("[migrate] Xong.");
}
