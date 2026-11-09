# Màn Flow video — Giai đoạn core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Cắm dữ liệu thật vào màn flow (tiến độ từng bước, ảnh từng cảnh, giọng đọc, prompt, nhật ký, model), cho phép chỉnh giọng/Short/tự đăng ngay trên node, và tự đăng YouTube theo lịch.

**Architecture:**
- **Tiến độ:** pipeline ghi vào cột jsonb `videos.progress` qua một `Tracker`, ghi thưa (tối đa 1 lần/3 giây, trừ khi đổi trạng thái). Asset (ảnh cảnh, giọng đọc) upload **dần** vào GitHub Release qua REST API; REST trả về asset id, ghép thẳng vào `videos.assets`, nên route `/api/videos/[id]/[file]` dùng lại được nguyên trạng.
- **Hiển thị:** `buildFlow()` ưu tiên dữ liệu `progress`, không có thì suy như giai đoạn UI. Client `router.refresh()` 3 giây/lần khi video đang chạy.
- **YouTube:** OAuth trên web, refresh token lưu trong `app_settings`. Job render upload ngay sau khi tạo release. Upload lỗi thì đăng lại bằng workflow `publish.yml` (tải file từ release về rồi upload, không render lại).

**Tech Stack:** như giai đoạn UI; YouTube Data API v3 gọi REST trực tiếp (upload resumable), không thêm thư viện.

**Spec:** `docs/superpowers/specs/2026-11-09-video-flow-design.md` (mục 1–2 phần dữ liệu thật, 4, 7, 8, phần Ràng buộc, các dòng quyết định trong bảng).

## Global Constraints

- Ràng buộc chung của plan UI vẫn áp dụng (tiếng Việt, không bịa số liệu, file chỉ đi qua `/api/videos/...`).
- **Người dùng không muốn thêm test mới.** Kiểm bằng typecheck/lint/build, giữ suite cũ xanh, kiểm bằng mắt bằng trang preview tạm.
- Pipeline chạy trên GitHub Actions. Khi chạy local (không có `GITHUB_ACTIONS`) thì bỏ qua upload asset và YouTube, giống `publishRelease` hiện nay.
- Không được làm hỏng luồng hiện có: render lỗi Short hay thumbnail vẫn ra video dài. Hết quota thì trả video về `queued` và giữ cache.
- Đăng YouTube: không đăng video lỗi. Không đăng trùng (có `youtubeVideoId` thì bỏ qua). `publishAt` đã qua hoặc còn dưới 15 phút thì lấy slot mới bằng `nextPublishSlot()`. Short lên lịch +2 giờ. `containsSyntheticMedia: true`. `privacyStatus: "private"` + `publishAt`. `selfDeclaredMadeForKids: false`.
- Token hỏng/hết hạn: `uploadStatus = "failed"`, ghi `uploadError`, báo Telegram; `status` vẫn `ready` để đăng tay.

## Review Focus

- **Render lại video đã đăng:** không được upload lần 2.
- **Token YouTube hết hạn** (`invalid_grant`): báo rõ "kết nối lại", không crash job, video vẫn `ready`.
- **Polling khi rời trang** (Next giữ trang ẩn bằng Activity): phải dừng interval khi trang ẩn, không gọi refresh vô hạn.
- **Ghi tiến độ dồn dập** (30 ảnh × 4 luồng song song): ghi thưa, không vượt giới hạn Neon, lỗi ghi tiến độ không được làm hỏng render.
- **Đổi giọng rồi render lại:** không dùng lại file TTS cache của giọng cũ.

---

### Task C1: Dữ liệu — cột mới, kiểu tiến độ, `buildFlow` dùng dữ liệu thật

**Files:** `src/db/schema.ts`, `drizzle/0004_*`, `src/lib/flow/progress.ts` (mới), `src/lib/flow/model.ts`, `src/lib/flow/data.ts`

**Interfaces — Produces:**
```ts
// progress.ts (dùng chung web + pipeline, thuần)
export type Part = { done: number; total: number };
export type StepProgress = {
  state: StepState; startedAt?: string; finishedAt?: string;
  long?: Part; short?: Part; model?: string; error?: string;
  log: { at: string; text: string }[];  // giữ 30 dòng cuối
};
export type Scene = { i: number; start: number; end: number; text: string; prompt: string; action: boolean; file?: string };
export type VideoProgress = {
  steps: Partial<Record<NodeId, StepProgress>>;
  scenes?: { long: Scene[]; short: Scene[] };
  prompts?: { meta?: string; scenes?: string };  // system+prompt đã gửi, cắt 4000 ký tự
};
// schema.ts — videos
progress: jsonb("progress").$type<VideoProgress>().notNull().default({ steps: {} }),
youtubeVideoId: text("youtube_video_id"), youtubeShortId: text("youtube_short_id"),
uploadStatus: text("upload_status").$type<"none" | "uploading" | "scheduled" | "failed">().notNull().default("none"),
uploadError: text("upload_error"),
// schema.ts — series
ttsVoice: text("tts_voice").notNull().default("Algenib"),
makeShort: boolean("make_short").notNull().default(true),
autoPublish: boolean("auto_publish").notNull().default(true),
// FlowData thêm: video.progress, video.uploadStatus, video.uploadError, video.youtubeVideoId, video.youtubeShortId,
//   series.ttsVoice, series.makeShort, series.autoPublish, youtube: { connected: boolean; channel: string | null }
// files: FileName mở rộng thành string (ảnh cảnh "long-img-3.jpg", "narration.m4a", "short-narration.m4a")
```
`buildFlow`:
- Bước nào có `progress.steps[id]` thì lấy `state` từ đó. Subtitle là tiến độ `Dài 18/30 · Short 3/5`, hoặc `long` một mình nếu không có `short`.
- Short lỗi thì gắn `warning`, node không chuyển đỏ.
- Node youtube lấy theo `uploadStatus`:
  - `uploading`: run, "đang upload"
  - `scheduled`: done, `"đã lên lịch · " + formatSlot`
  - `failed`: error, kèm `warning = uploadError`
- Thiếu progress thì giữ nguyên quy tắc cũ (test cũ phải còn xanh).

- [ ] Viết các thay đổi trên, `pnpm db:generate` → xem lại SQL chỉ có ALTER TABLE thêm cột.
- [ ] `pnpm typecheck && pnpm test` → xanh. Commit `feat(core): cột tiến độ, YouTube, cài đặt node`.

### Task C2: Pipeline ghi tiến độ + upload asset dần

**Files:** `pipeline/progress.ts` (mới), `pipeline/release.ts` (mới, chuyển `publishRelease` sang), `pipeline/render.ts`, `pipeline/tts.ts`, `src/lib/ai/types.ts`, `src/lib/ai/gemini.ts`

**Interfaces — Produces:**
```ts
// progress.ts
export class Tracker {
  constructor(videoId: number);
  start(step: NodeId, part?: { long?: number; short?: number }): void;
  tick(step: NodeId, which: "long" | "short", text?: string): void;   // done++
  log(step: NodeId, text: string): void;
  set(patch: Partial<Omit<VideoProgress, "steps">>): void;
  model(step: NodeId, model: string): void;
  finish(step: NodeId, state?: "done" | "error" | "skip", error?: string): void;
  flush(): Promise<void>;   // ghi ngay; lỗi DB chỉ console.warn
}
// release.ts
export async function ensureRelease(videoId: number, fresh: boolean): Promise<number | null>; // release id; null khi không chạy trên Actions
export async function uploadAsset(videoId: number, releaseId: number | null, file: string, name?: string): Promise<void>; // upload (thay nếu trùng tên) rồi ghép {name: id} vào videos.assets
// ai/types.ts: TextProvider thêm `readonly lastModel?: string` — GeminiProvider gán khi gọi thành công
// tts.ts: speak(text, outFile, voice = process.env.TTS_VOICE ?? "Algenib")
```
Instrument `renderVideo`:
- **Đầu job:**
  - `ensureRelease(id, fresh)`. `fresh` là true khi video chưa có `youtubeVideoId`: xóa release cũ rồi đặt `assets = {}`.
  - Reset `progress = { steps: {} }`.
- **agent:**
  - Gói `videoMeta` + `scenePrompts` (dài + Short).
  - `model(agent, textProvider().lastModel)`.
  - `set({ prompts })`: tự dựng lại chuỗi prompt trong `prompts.ts`, export thêm hàm `metaPrompt(s, c)`.
- **tts:**
  - Tính tổng số khối cho từng bản (`packChunks` độ dài hiện tại) rồi `start`.
  - Mỗi khối xong thì `tick`.
  - Tên file cache có giọng: `tts-${voice}-000.wav`.
  - Nối xong thì `ffmpeg -ac 1 -b:a 64k` → `narration.m4a` (Short: `short-narration.m4a`) rồi `uploadAsset`.
- **images:** `start` với `long = n` (+5 nếu làm Short, +1 cho thumbnail).
  - Ghi `scenes` (text, prompt, mốc thời gian) trước khi vẽ.
  - Mỗi ảnh vẽ xong thì `uploadAsset` (tên `long-img-<i>.jpg` / `short-img-<i>.jpg`), gán `file`, rồi `tick`.
  - Ảnh vẽ trong `buildVideo` (`pool` của shots): chỉ đếm lần vẽ đầu tiên của mỗi ảnh.
- **video:** `start` với số shot. Tick mỗi shot, `log` khi ghép nhóm và khi trộn tiếng.
- **Short:**
  - `series.makeShort = false` → bỏ qua, `finish(..., "skip")` cho phần Short.
  - Short lỗi → `log` + `warning`, không đánh dấu `error` cả bước.
- **Kết thúc:**
  - Lỗi thì `finish(stepĐangChạy, "error", msg)`.
  - Hết quota thì giữ `run`, kèm log "chờ quota".
  - `publishRelease` cũ thay bằng `uploadAsset` cho các file còn lại (`long.mp4`, `short.mp4`, `thumbnail.jpg`, `youtube.txt`).

- [ ] Viết, `pnpm typecheck && pnpm lint && pnpm test` xanh. Kiểm local nhanh bằng `BURN_TEXT=0` không cần (không có DB) → ghi rõ trong ledger là chưa chạy thật.
- [ ] Commit `feat(pipeline): ghi tiến độ từng bước, upload ảnh cảnh và giọng đọc dần`.

### Task C3: YouTube — kết nối OAuth + tự đăng + đăng lại

**Files:** `src/lib/youtube.ts` (mới), `src/app/api/youtube/connect/route.ts`, `src/app/api/youtube/callback/route.ts`, `pipeline/youtube.ts` (mới), `pipeline/publish.ts` (mới, CLI), `.github/workflows/publish.yml` (mới), `.github/workflows/render.yml` + `daily.yml` (thêm env), `src/lib/story/videos.ts` (`dispatchPublish`), `src/app/actions.ts`, `README.md`, `.env.example`

**Interfaces — Produces:**
```ts
// src/lib/youtube.ts
export const YT_KEY = "youtube";
export type YoutubeAuth = { refreshToken: string; channel: string | null; connectedAt: string };
export function authUrl(state: string, redirectUri: string): string;      // scopes: youtube.upload + youtube.force-ssl (thumbnail), access_type=offline, prompt=consent
export async function exchangeCode(code: string, redirectUri: string): Promise<YoutubeAuth>; // lấy kèm tên kênh (channels.list mine=true)
export async function accessToken(refreshToken: string): Promise<string>; // invalid_grant → throw YoutubeAuthError
export class YoutubeAuthError extends Error {}
export async function getYoutubeAuth(): Promise<YoutubeAuth | null>;
// pipeline/youtube.ts
export async function publishToYoutube(videoId: number, files: { long: string; short?: string; thumb?: string }): Promise<void>;
// actions.ts
export async function retryPublishAction(videoId: number): Promise<ActionState>;   // uploadStatus='none', dispatch publish.yml
export async function disconnectYoutubeAction(): Promise<ActionState>;
export async function updateFlowSettingsAction(seriesId: number, patch: { ttsVoice?: string; makeShort?: boolean; autoPublish?: boolean }): Promise<ActionState>;
```
- **OAuth:**
  - `redirectUri = ${WEB_URL}/api/youtube/callback`.
  - `state` ngẫu nhiên lưu trong cookie httpOnly, có hạn 10 phút. Callback so khớp state, lưu token rồi redirect về `/videos?youtube=connected`.
  - Env: `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`.
- **`publishToYoutube`** chỉ chạy khi các điều kiện sau đều đúng:
  - `series.autoPublish`
  - đã kết nối YouTube
  - video chưa có `youtubeVideoId`
  - chạy trên Actions

  Thứ tự:
  1. Đặt `uploadStatus = "uploading"` và `Tracker` bước youtube.
  2. Upload video dài, lưu `youtubeVideoId` ngay.
  3. Đặt thumbnail; lỗi thì log cảnh báo.
  4. Upload Short (nếu có): lịch +2 giờ, lưu `youtubeShortId`.
  5. Đặt `uploadStatus = "scheduled"`, `status = "published"`, `youtubeUrl = https://youtu.be/<id>`, rồi báo Telegram.

  Upload theo kiểu resumable: POST lấy `Location`, rồi PUT toàn bộ file (đọc stream, kèm `Content-Length`).
- **`pipeline/publish.ts <id>`:** `gh release download video-<id>` về thư mục tạm, rồi `publishToYoutube`. `publish.yml` giống `render.yml` nhưng không cài ffmpeg, không dùng cache.
- **README:** thêm phần "Tự đăng YouTube":
  - Tạo project Google Cloud, bật YouTube Data API v3.
  - Tạo OAuth client loại Web, thêm redirect URI.
  - Chuyển app sang **In production** (Testing thì token hết hạn sau 7 ngày).
  - Thêm 2 env vào Vercel và GitHub secrets, rồi bấm "Kết nối YouTube".
  - Lưu ý **audit**: chưa duyệt thì video bị khóa riêng tư. Có link form audit.

- [ ] Viết; typecheck/lint/test/build xanh. Commit `feat(youtube): kết nối OAuth, tự đăng theo lịch, đăng lại`.

### Task C4: UI dùng dữ liệu thật + chỉnh trên node

**Files:** `src/components/flow/flow-studio.tsx`, `src/components/flow/panels.tsx`, `src/components/flow/nodes.tsx`, `src/lib/flow/voices.ts` (mới)

- **Polling:**
  - Hook trong `flow-studio` gọi `router.refresh()` 3 giây/lần khi `status` là `rendering`, hoặc `uploadStatus` là `uploading`, hoặc `status` là `queued` mà không có `error`.
  - Dừng khi trang ẩn (`document.visibilityState`, cleanup bằng `useLayoutEffect` cho Activity).
  - Đồng bộ `data` mới vào node bằng `setNodes` và giữ nguyên vị trí.
- **Node:** subtitle tiến độ lấy từ `buildFlow`. Node `run` có thanh progress mảnh dưới icon.
- **Panel:**
  - **agent:** model thật. Tab "Đầu vào / Prompt" hiện `prompts.meta`/`prompts.scenes`. Tab "Nhật ký" hiện `log`.
  - **tts:**
    - `<audio>` cho `narration.m4a` / `short-narration.m4a`.
    - `<select>` giọng: `VOICES` gồm 30 giọng Gemini TTS, mỗi giọng có mô tả tiếng Việt ngắn.
    - Đổi giọng thì gọi `updateFlowSettingsAction`, có ghi chú "áp dụng từ lần render sau".
  - **images:**
    - Lưới ảnh từ `progress.scenes` có nút chuyển Dài/Short.
    - Ảnh chưa vẽ hiện ô sọc. Nhãn mốc thời gian `m:ss`.
    - Bấm ảnh thì mở lightbox, có prompt + đoạn truyện.
  - **video:** công tắc "Làm Short" (`makeShort`). Nhật ký bước.
  - **youtube:**
    - Trạng thái kết nối: tên kênh, nút "Kết nối YouTube" (link `/api/youtube/connect`), nút "Ngắt kết nối".
    - Công tắc "Tự đăng" (`autoPublish`).
    - `uploadStatus`, `uploadError`, nút "Đăng lại" khi `failed`.
    - Link YouTube cho cả video dài và Short.
    - Ghi chú audit khi `scheduled`.
  - Mọi tab "Nhật ký" lấy `progress.steps[id].log`.
- **Kiểm bằng mắt:** trang preview tạm với fixture có `progress` (đang chạy 18/30, có ảnh giả dạng data URI) ở 1440px và 390px (iframe). Xem xong thì xóa trang tạm.

- [ ] Viết; typecheck/lint/test/build xanh; chụp màn hình. Commit `feat(flow): hiện tiến độ thật, ảnh cảnh, giọng đọc, chỉnh nhanh trên node`.
