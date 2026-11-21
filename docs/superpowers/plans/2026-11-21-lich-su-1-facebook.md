# Kênh lịch sử — Kế hoạch 1/4: Facebook Page (kết nối + đăng Reel + đăng video dài)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hệ thống lưu được token Page Facebook theo kênh và đăng được 1 Reel (≤90s, 9:16) và 1 video dài lên Page "Sử Ký Kể Chuyện" qua Graph API; có lệnh CLI để chủ kênh kết nối và đăng thử.

**Architecture:** Module thuần `src/lib/facebook.ts` theo đúng mẫu `src/lib/youtube.ts`: token Page mã hoá trong `app_settings` khoá `facebook:<kênh>`. Kết nối bằng CLI (đổi user token ngắn hạn → user token dài hạn → Page token không hết hạn), không làm OAuth web (YAGNI — một chủ kênh, một Page). Đăng Reel theo 3 pha `video_reels` (start → upload rupload → finish); video dài theo upload chia mảnh `/{page}/videos` (start → transfer → finish).

**Tech Stack:** TypeScript, Node 24 `fetch`, drizzle (`app_settings`), vitest (mock `fetch` bằng `vi.stubGlobal`), `tsx` cho CLI.

**Spec:** `docs/superpowers/specs/2026-11-21-kenh-lich-su-design.md` (mục 9 + "Làm phần Facebook ĐẦU TIÊN")

Thứ tự 4 kế hoạch: **1. Facebook (này)** → 2. Kênh + tư liệu + kịch bản + soát sự thật → 3. Hình (Commons, bản đồ, motion graphics, QC) → 4. Reels (chọn đoạn, dựng dọc, hàng đợi 3/ngày) + đăng bản dài lên Page sau YouTube.

## Global Constraints

- Khoá kênh: `lich-su`. Khoá app_settings: `facebook:lich-su`. Page id: `61596491473917`.
- Token Page lưu **mã hoá** bằng `encrypt`/`decrypt` (`src/lib/crypto.ts`); không bao giờ log token.
- Graph API version một hằng duy nhất `GRAPH_VERSION = "v27.0"`.
- Reels API: 3–90 giây, dọc 9:16, tối đa 30 Reel/24 giờ — hàm đăng Reel từ chối file > 90s hoặc < 3s trước khi gọi API (đo bằng ffprobe có sẵn trong pipeline).
- Lỗi token (Graph error code 190) → `FacebookAuthError` với thông điệp tiếng Việt bảo chạy lại lệnh kết nối; không làm hỏng luồng YouTube.
- App id/secret: env `FB_APP_ID`, `FB_APP_SECRET`, thêm vào `SECRET_KEYS` (group `service`).
- Chuỗi hiển thị cho người dùng bằng tiếng Việt có dấu.

## Review Focus

- User token ngắn hạn đã hết hạn (1–2 giờ) khi chạy lệnh kết nối → báo rõ "token hết hạn, lấy token mới ở Graph API Explorer", không ghi gì vào DB.
- Tài khoản quản lý nhiều Page / không quản lý Page 61596491473917 → báo danh sách Page tìm thấy, không lưu nhầm Page.
- Upload video dài lỗi giữa chừng (mạng chập ở mảnh thứ n) → thử lại mảnh đó ≤ 3 lần, rồi ném lỗi có số mảnh; không gọi finish với file thiếu.
- Reel bị Meta từ chối do app chưa đủ quyền (lỗi #200/#10 permission) → thông điệp nói rõ "cần quyền …/App Review", phân biệt với lỗi token.
- Kênh chưa kết nối Facebook → `getFacebookAuth` trả null, hàm đăng ném `FacebookAuthError("Chưa kết nối Facebook cho kênh …")`.

---

### Task 1: Lưu token Page + đổi token + lệnh kết nối

**Files:**
- Create: `src/lib/facebook.ts`
- Create: `src/lib/facebook.test.ts`
- Create: `scripts/fb-connect.mts`
- Modify: `src/lib/secret-keys.ts` (thêm `FB_APP_ID`, `FB_APP_SECRET` vào `SECRET_KEYS`, sau 2 dòng YouTube)
- Modify: `README.md` (mục mới "Kết nối Facebook Page")

**Interfaces:**
- Produces:
  - `GRAPH_VERSION: "v27.0"`; `fbKey(ch: string): string` → `"facebook:" + ch`
  - `type FacebookAuth = { pageId: string; pageName: string; pageToken: string; connectedAt: string }`
  - `class FacebookAuthError extends Error`
  - `parseFacebookAuth(raw: unknown): FacebookAuth | null` (giải mã `pageToken`)
  - `getFacebookAuth(ch: string): Promise<FacebookAuth | null>`; `saveFacebookAuth(auth: FacebookAuth | null, ch: string): Promise<void>`
  - `graphError(body: unknown, status: number): Error` — code 190 → `FacebookAuthError`; code 10/200/≥200&<300 → `Error` có chữ "quyền"; khác → `Error("Facebook lỗi: <message>")`
  - `pickPage(accounts: { id: string; name: string; access_token: string }[], pageId: string): { id; name; access_token }` — ném `Error` liệt kê tên+id các Page tìm thấy nếu không có `pageId`
  - `exchangePageToken(userToken: string, pageId: string): Promise<FacebookAuth>` — `GET /oauth/access_token?grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token` → `GET /me/accounts?access_token=<long>&limit=100` → `pickPage`
  - `pageAccessToken(ch: string): Promise<{ pageId: string; token: string }>` — ném `FacebookAuthError` nếu chưa kết nối

- [ ] **Step 1: Viết test thất bại** trong `src/lib/facebook.test.ts`:
  - `fbKey("lich-su")` → `"facebook:lich-su"`.
  - `pickPage([{id:"1",name:"A",access_token:"t1"},{id:"61596491473917",name:"Sử Ký Kể Chuyện",access_token:"t2"}], "61596491473917").access_token` → `"t2"`; với `pageId "999"` → ném lỗi mà message chứa `"A (1)"` và `"Sử Ký Kể Chuyện (61596491473917)"`.
  - `graphError({error:{code:190,message:"expired"}}, 400)` là `instanceof FacebookAuthError`; `graphError({error:{code:200,message:"perm"}}, 403).message` chứa `"quyền"`; `graphError({}, 500).message` chứa `"500"`.
  - `exchangePageToken("short","61596491473917")` với `fetch` mock trả lần 1 `{access_token:"long"}`, lần 2 `{data:[{id:"61596491473917",name:"Sử Ký Kể Chuyện",access_token:"pt"}]}` → `{pageId:"61596491473917", pageName:"Sử Ký Kể Chuyện", pageToken:"pt"}`; URL lần 1 chứa `grant_type=fb_exchange_token` và `fb_exchange_token=short`; URL lần 2 chứa `/me/accounts` và `access_token=long`. Đặt `process.env.FB_APP_ID/FB_APP_SECRET` trong test.
  - `exchangePageToken` khi lần 1 trả `{error:{code:190}}` → ném `FacebookAuthError`, lần 2 không được gọi.
  - `parseFacebookAuth(undefined)` → `null`; `parseFacebookAuth({pageId:"1",pageName:"A",pageToken:"plain",connectedAt:"x"}).pageToken` → `"plain"` (giá trị chưa mã hoá đọc nguyên, như `decrypt`).

- [ ] **Step 2: Chạy, thấy fail** — `pnpm exec vitest run src/lib/facebook.test.ts` → FAIL "Cannot find module './facebook'".

- [ ] **Step 3: Cài đặt** các hàm trong Interfaces ở `src/lib/facebook.ts`. `getFacebookAuth`/`saveFacebookAuth` copy mẫu `getYoutubeAuth`/`saveYoutubeAuth` (`src/lib/youtube.ts`) với `fbKey`. Thiếu `FB_APP_ID`/`FB_APP_SECRET` → `Error("Thiếu FB_APP_ID / FB_APP_SECRET — xem README phần Kết nối Facebook Page.")`.

- [ ] **Step 4: Chạy, thấy pass** — cùng lệnh → PASS.

- [ ] **Step 5: CLI `scripts/fb-connect.mts`** — dùng: `pnpm exec tsx scripts/fb-connect.mts <kênh> <userToken> [pageId]` (pageId mặc định `61596491473917`). Gọi `loadSecrets()` (`src/lib/secrets.ts`) rồi `exchangePageToken` → `saveFacebookAuth` → in `Đã kết nối Page "<tên>" (<id>) cho kênh <kênh>`. Không in token. Kiểm `isChannelKey(kênh)` (`src/lib/youtube.ts`).

- [ ] **Step 6: README** — mục "Kết nối Facebook Page": tạo app ở developers.facebook.com (loại Business), thêm sản phẩm "Facebook Login for Business"/Pages API; lấy App ID/Secret dán vào trang Cài đặt (FB_APP_ID/FB_APP_SECRET); Graph API Explorer chọn app → User Token với quyền `pages_show_list, pages_read_engagement, pages_manage_posts, publish_video` → chạy lệnh ở Step 5. Ghi chú: app ở chế độ Development vẫn đăng được lên Page mà mình là admin; nếu bài đăng không hiện công khai thì cần chuyển app sang Live.

- [ ] **Step 7: Typecheck + commit**
  Run: `pnpm typecheck` → không lỗi.
  ```bash
  git add src/lib/facebook.ts src/lib/facebook.test.ts scripts/fb-connect.mts src/lib/secret-keys.ts README.md
  git commit -m "feat(facebook): lưu token Page theo kênh + lệnh kết nối"
  ```

### Task 2: Đăng Reel + lệnh đăng thử

**Files:**
- Modify: `src/lib/facebook.ts`
- Modify: `src/lib/facebook.test.ts`
- Create: `scripts/fb-test-post.mts`

**Interfaces:**
- Consumes: `pageAccessToken`, `graphError`, `GRAPH_VERSION` (Task 1)
- Produces:
  - `REEL_MIN_SECONDS = 3`, `REEL_MAX_SECONDS = 90`
  - `checkReelDuration(seconds: number): void` — ngoài [3, 90] ném `Error("Reel phải dài 3–90 giây, file này <n> giây")`
  - `publishReel(ch: string, file: string, opts: { description: string; seconds: number; scheduledAt?: Date }): Promise<{ videoId: string }>`
    - pha 1: `POST https://graph.facebook.com/<v>/<pageId>/video_reels` body `upload_phase=start&access_token=…` → `{video_id, upload_url}`
    - pha 2: `POST <upload_url>` headers `Authorization: OAuth <token>`, `offset: 0`, `file_size: <bytes>`, body = nội dung file → `{success:true}`
    - pha 3: `POST …/video_reels` body `upload_phase=finish&video_id&description&video_state=PUBLISHED` (có `scheduledAt` → `video_state=SCHEDULED&scheduled_publish_time=<unix giây>`)
    - mỗi pha: `!res.ok` hoặc body có `error` → `throw graphError(body, res.status)`

- [ ] **Step 1: Test thất bại**:
  - `checkReelDuration(2.9)` và `checkReelDuration(90.5)` ném; `checkReelDuration(60)` không ném.
  - `publishReel` với file tạm 1KB, `fetch` mock 3 phản hồi (`{video_id:"v1",upload_url:"https://rupload.facebook.com/video-upload/v27.0/v1"}`, `{success:true}`, `{success:true}`), mock `getFacebookAuth` qua `vi.mock("./facebook", …)` hoặc tách `pageAccessToken` thành tham số tiêm — chọn cách nào miễn test không chạm DB → trả `{videoId:"v1"}`; lời gọi 2 có header `offset: "0"` và `file_size: "1024"`; lời gọi 3 body chứa `upload_phase=finish`, `video_id=v1`, `video_state=PUBLISHED`.
  - Với `scheduledAt = new Date("2026-12-01T01:00:00Z")` → body pha 3 chứa `video_state=SCHEDULED` và `scheduled_publish_time=1796086800`.
  - Pha 2 trả 500 → ném, và pha 3 **không** được gọi.
  - `seconds: 120` → ném trước khi gọi `fetch`.

- [ ] **Step 2: Chạy, thấy fail** — `pnpm exec vitest run src/lib/facebook.test.ts` → FAIL `publishReel is not a function`.

- [ ] **Step 3: Cài đặt** `checkReelDuration`, `publishReel` như Interfaces.

- [ ] **Step 4: Chạy, thấy pass.**

- [ ] **Step 5: CLI `scripts/fb-test-post.mts`** — `pnpm exec tsx scripts/fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"`: đo thời lượng bằng ffprobe (`FFMPEG` env hoặc `ffprobe` trong PATH, cùng cách `pipeline/ffmpeg.ts` tìm), gọi `publishReel`, in `Đã đăng Reel <videoId> — https://www.facebook.com/reel/<videoId>`.

- [ ] **Step 6: Commit**
  ```bash
  git add src/lib/facebook.ts src/lib/facebook.test.ts scripts/fb-test-post.mts
  git commit -m "feat(facebook): đăng Reel lên Page (3 pha) + lệnh đăng thử"
  ```

### Task 3: Đăng video dài (upload chia mảnh)

**Files:**
- Modify: `src/lib/facebook.ts`, `src/lib/facebook.test.ts`, `scripts/fb-test-post.mts`

**Interfaces:**
- Consumes: Task 1–2
- Produces:
  - `publishPageVideo(ch: string, file: string, opts: { title: string; description: string; scheduledAt?: Date }): Promise<{ videoId: string }>`
    - `POST https://graph-video.facebook.com/<v>/<pageId>/videos` `upload_phase=start&file_size` → `{upload_session_id, video_id, start_offset, end_offset}`
    - lặp: `upload_phase=transfer&upload_session_id&start_offset&video_file_chunk=<Blob mảnh [start,end)>` (multipart `FormData`) → `{start_offset, end_offset}` mới; dừng khi `start_offset === end_offset`; mỗi mảnh thử lại ≤ 3 lần rồi ném `Error("Upload Facebook hỏng ở mảnh <n> (byte <start>)")`
    - `upload_phase=finish&upload_session_id&title&description` (+ `published=false&scheduled_publish_time` khi có `scheduledAt`)

- [ ] **Step 1: Test thất bại**:
  - File tạm 2.500 byte; mock start trả `start_offset:"0", end_offset:"1000"`; transfer lần 1 trả `1000/2000`, lần 2 `2000/2500`, lần 3 `2500/2500`; finish `{success:true}` → `{videoId}` = video_id của start; đúng 3 lời gọi transfer, mảnh lần 2 có kích thước 1000, lần 3 kích thước 500.
  - Transfer mảnh 2 lỗi 2 lần rồi thành công → kết quả vẫn OK (tổng 5 lời gọi transfer).
  - Transfer mảnh 2 lỗi 4 lần → ném lỗi chứa `"mảnh 2"`; finish không được gọi.

- [ ] **Step 2: Chạy, thấy fail.**
- [ ] **Step 3: Cài đặt** `publishPageVideo`. Đọc mảnh bằng `fs.promises.open` + `read` theo offset (không đọc cả file 45 phút vào RAM).
- [ ] **Step 4: Chạy, thấy pass.**
- [ ] **Step 5: CLI** — thêm chế độ `video`: `fb-test-post.mts <kênh> video <file.mp4> "<tiêu đề>" "<mô tả>"` → in `Đã đăng video <id> — https://www.facebook.com/<pageId>/videos/<id>`.
- [ ] **Step 6: Toàn bộ test + typecheck + lint**
  Run: `pnpm test && pnpm typecheck && pnpm lint` → tất cả PASS.
- [ ] **Step 7: Commit**
  ```bash
  git add src/lib/facebook.ts src/lib/facebook.test.ts scripts/fb-test-post.mts
  git commit -m "feat(facebook): đăng video dài lên Page (upload chia mảnh, thử lại từng mảnh)"
  ```

### Task 4: Phép thử thật trên Page (cần chủ kênh)

Không viết code. Chủ kênh làm theo README (Task 1 Step 6), rồi:

- [ ] **Step 1:** `pnpm exec tsx scripts/fb-connect.mts lich-su <userToken>` → in "Đã kết nối Page "Sử Ký Kể Chuyện" (61596491473917)".
- [ ] **Step 2:** Tạo Reel thử 10 giây dọc: `ffmpeg -f lavfi -i color=c=0x3b2a1a:s=1080x1920:d=10 -f lavfi -i anullsrc -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac test-reel.mp4`, chạy `fb-test-post.mts lich-su reel test-reel.mp4 "Thử hệ thống"`.
- [ ] **Step 3:** Mở link bằng **trình duyệt ẩn danh / tài khoản khác**: Reel hiện công khai → PASS. Không hiện → ghi lại, chuyển app sang Live (có thể cần App Review) trước Kế hoạch 4.
- [ ] **Step 4:** Xoá Reel thử trên Page. Ghi kết quả (PASS/BLOCKED + lý do) vào `HANDOFF.md`.
