# Ma Tôn Studio

Xưởng viết truyện tự động cho kênh YouTube "Ma Tôn Truyện". Kế hoạch tổng: `PLAN.md`.

**P1 (bản này):** ý tưởng → AI dựng story bible → lên dàn ý chương → AI viết chương (nhớ mạch qua tóm tắt) → sửa / duyệt.

## Deploy lên Vercel
1. `pnpm dlx vercel login` rồi `pnpm dlx vercel link`
2. Vercel dashboard → project → Storage → thêm **Neon** (free) → tự có `DATABASE_URL`
3. Settings → Environment Variables: `GEMINI_API_KEY`, `ADMIN_PASSWORD`
4. `pnpm dlx vercel --prod` — build tự chạy migration (`scripts/migrate.mjs`)

## Lệnh
| Lệnh | Việc |
|---|---|
| `pnpm test` / `pnpm lint` / `pnpm typecheck` | kiểm tra |
| `pnpm db:generate` | sinh migration sau khi sửa `src/db/schema.ts` |
