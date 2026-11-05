import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Pipeline chờ AI vài phút rồi mới ghi DB → socket keep-alive cũ bị đóng, fetch lỗi "fetch failed". Thử lại khi lỗi mạng.
neonConfig.fetchFunction = async (input: RequestInfo | URL, init?: RequestInit) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
};

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
