# Ma Tôn Studio

Xưởng viết truyện tự động cho kênh YouTube "Thôn Phệ Audio". Kế hoạch tổng: `PLAN.md`.

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

### Dùng gói Claude Pro / ChatGPT Plus / Gemini (không tốn credit API)
Job GitHub Actions cài **Claude Code**, **Codex** và **Gemini CLI**, rồi gọi chúng bằng đăng nhập gói của bạn. Kết nối cả 3 gói bằng **một lệnh** trên máy bạn (cần `gh` đã đăng nhập):

```
node scripts/ai-login.mjs
```

Script mở trình duyệt cho từng gói — bạn chỉ bấm **Cho phép** — rồi tự lưu vào GitHub Secrets (`CLAUDE_CODE_OAUTH_TOKEN`, `CODEX_AUTH_JSON`, `GEMINI_OAUTH_CREDS`), tự chạy workflow **ai-check** gọi thử và ghi trạng thái lên trang **Cài đặt AI**. Đăng nhập lại 1 gói: `node scripts/ai-login.mjs codex` (claude | codex | gemini).

- Chỉ chạy trong job GitHub Actions (render, viết chương hằng ngày). Nút viết trên web (Vercel) vẫn dùng API.
- Hạn mức dùng chung với lúc bạn chat. Hết lượt gói thì tự chuyển sang AI kế tiếp (cuối cùng là Gemini API free).
- Đăng nhập hết hạn thì chạy lại lệnh trên (Claude ~1 năm; Codex tự làm mới token và lưu lại).

Mặc định chia việc ra 3 gói cho đỡ hết lượt: viết truyện Claude, tiêu đề/mô tả ChatGPT, tóm tắt + prompt ảnh Gemini; sau đó mới tới API trả phí, cuối cùng Gemini API free.

### Điểm SEO + Magic fill
Bảng AI Agent chấm 0–100 tiêu đề, mô tả, tag, Short (tiêu đề dùng điểm vidIQ nếu có). Điểm tổng < 90 thì render tự cho AI sửa đúng các tiêu chí mất điểm (tối đa 3 lượt). Video cũ: bấm **Magic fill** — video đã lên YouTube thì cập nhật luôn trên YouTube.

## vidIQ (SEO YouTube)
Có `VIDIQ_API_KEY` thì trước khi viết tiêu đề/mô tả/tag, job render tra **từ khóa thật** trên vidIQ rồi đưa vào prompt; AI đề xuất 3 tiêu đề, vidIQ **chấm điểm** và app lấy tiêu đề cao nhất. Mỗi video tốn khoảng 20 credit vidIQ (1 lượt từ khóa + 3 lượt chấm). Tắt phần chấm tiêu đề: đặt `VIDIQ_SCORE_TITLES=0`.

1. app.vidiq.com → Account Settings → **MCP** → tạo API key.
2. GitHub → Settings → Secrets → Actions → thêm `VIDIQ_API_KEY` (chỉ job render dùng, không cần đặt ở Vercel).
3. Muốn hỏi vidIQ trực tiếp trong Claude Code: repo đã có `.mcp.json` — mở Claude Code trong thư mục này, đồng ý bật server `vidiq`, gõ `/mcp` để đăng nhập.

vidIQ lỗi hoặc hết credit thì video vẫn ra bình thường, chỉ không có dữ liệu từ khóa.

## Chạy pipeline trên máy ảo Oracle free (0 phút GitHub Actions)
Repo private chỉ có ~2.000 phút Actions/tháng; 1 tập/ngày dùng ~1.800–2.100 phút. Chạy job trên máy riêng (self-hosted runner) thì không tính phút.

1. [cloud.oracle.com](https://cloud.oracle.com) → tạo tài khoản Free Tier (cần thẻ để xác minh). Nên **Upgrade to Pay As You Go** (vẫn free trong hạn mức Always Free) — tài khoản free thuần có thể bị Oracle thu hồi máy "rảnh" (CPU thấp nhiều ngày).
2. Compute → Instances → Create: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** 4 OCPU / 24 GB (Always Free). Báo "Out of capacity" thì thử lại sau hoặc đổi Availability Domain.
3. SSH vào máy, chép `scripts/oracle-runner.sh` lên rồi chạy với token (repo → Settings → Actions → Runners → New self-hosted runner):
   `TOKEN=<token> bash oracle-runner.sh`
4. Repo → Settings → Secrets and variables → Actions → **Variables** → `RUNNER_LABEL` = `oracle`. Xoá biến là quay về máy GitHub.

### Hoặc chạy trên Railway (dễ hơn Oracle)
Thư mục `runner/` là container GitHub runner (image chính chủ `actions-runner`), Railway Hobby (~$5/tháng, đã gồm $5 tiền dùng).

1. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate: chỉ repo `ma-ton-studio`, quyền **Administration: Read and write** → copy token.
2. [railway.com](https://railway.com) → đăng nhập bằng GitHub → New Project → **Deploy from GitHub repo** → chọn repo này.
3. Service vừa tạo → Settings → **Root Directory** = `runner` (Railway tự dùng `runner/Dockerfile`, `runner/railway.json`).
4. Variables: `GH_PAT` = token ở bước 1 (tuỳ chọn `RUNNERS` = 2, `LABEL` = railway).
5. Deploy xong, repo → Settings → Actions → Runners thấy `railway-1`, `railway-2` Idle → đặt biến repo `RUNNER_LABEL` = `railway`.
