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

## Tự đăng YouTube
Render xong là app tự upload video dài + Short, đặt thumbnail, bật nhãn nội dung AI và **lên lịch** đúng giờ (19h, Short sau 2 tiếng). Làm một lần:

1. [Google Cloud Console](https://console.cloud.google.com/) → tạo project → **APIs & Services → Library** → bật **YouTube Data API v3**.
2. **OAuth consent screen**: kiểu *External*, thêm email của bạn. Sau đó bấm **Publish app** để chuyển sang *In production* — để ở *Testing* thì token hết hạn sau 7 ngày. App chưa xác minh vẫn dùng được cho chính bạn, chỉ hiện màn cảnh báo "Google chưa xác minh" → bấm *Nâng cao → Tiếp tục*.
3. **Credentials → Create credentials → OAuth client ID** → loại *Web application* → *Authorized redirect URIs*: `https://<tên-miền-vercel>/api/youtube/callback`.
4. Thêm `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` vào **Vercel** (Environment Variables) **và** GitHub repo → Settings → Secrets → Actions. Redeploy Vercel.
5. Vào web → mở một video → node **Đăng YouTube** → **Kết nối YouTube** → chọn đúng kênh.

> **Quan trọng — audit của Google:** project tạo sau 28/7/2020 chưa qua kiểm duyệt thì mọi video upload bằng API bị **khoá ở chế độ riêng tư**, kể cả đã lên lịch. Nộp đơn miễn phí tại [YouTube API Services audit form](https://support.google.com/youtube/contact/yt_api_form) (thường mất vài tuần). Trong lúc chờ: app vẫn upload + lên lịch, bạn vào YouTube Studio bấm công khai.

Upload lỗi (token hết hạn, hết quota API…) thì Telegram báo, video vẫn ở trạng thái *sẵn sàng*: bấm **Kết nối lại** rồi **Đăng lại** trên node Đăng YouTube (chạy workflow `publish.yml`, không render lại).

## Nhiều AI (Claude, ChatGPT, Gemini)
App dùng được cùng lúc **Claude** (`ANTHROPIC_API_KEY`), **ChatGPT** (`OPENAI_API_KEY`) và **Gemini** (`GEMINI_API_KEY`). Key nào có thì AI đó chạy, không có thì tự bỏ qua.

1. Lấy key: [console.anthropic.com](https://console.anthropic.com/) (Claude), [platform.openai.com](https://platform.openai.com/api-keys) (ChatGPT). Đây là API trả theo lượt dùng — **khác** gói Claude Pro / ChatGPT Plus.
2. Thêm key vào **Vercel** (Environment Variables → redeploy) **và** GitHub → Settings → Secrets → Actions (để job tự viết + render dùng được).
3. Vào **Cài đặt AI** trên web: bấm **Thử** để kiểm tra key, rồi sắp thứ tự AI cho từng việc — viết truyện, tóm tắt, tiêu đề/mô tả YouTube, prompt ảnh. AI đầu lỗi / hết tiền / từ chối thì tự chuyển AI sau.

Mặc định: viết truyện Claude → ChatGPT → Gemini; việc phụ dùng Gemini free trước, hết lượt mới sang AI trả phí.
