# Kênh lịch sử — Kế hoạch 5a: Trang quản lý (đề tài, kịch bản, nguồn, lỗi sự thật)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menu "Lịch sử" → trang `/lich-su` quản lý kênh Sử Ký Kể Chuyện: danh sách đề tài + trạng thái, thêm đề tài, nút viết kịch bản kế tiếp; trang chương lịch sử hiện nguồn tư liệu và lỗi sự thật kèm nút soát lại. Tab Reels / Bình luận / Số liệu có khung + trạng thái trống (dữ liệu tới ở kế hoạch 3–5).

**Architecture:** Server component đọc DB (mẫu `src/app/series/[id]/page.tsx`); tab theo `?tab=` (link, không state client). Việc nặng (viết, soát) chạy trên GitHub Actions qua `render.yml` — server action gọi `dispatchCommand("historyscript:<id>" | "factcheck:<id>")`. Trạng thái đề tài là hàm thuần `historyTopicStatus` (test được).

**Tech Stack:** Next.js 16 App Router (server components + server actions), Tailwind 4, lucide-react, drizzle, vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-kenh-lich-su-design.md` mục 11.

## Global Constraints

- Route `/lich-su`; menu label "Lịch sử", icon `Landmark` (lucide), đặt sau "Video".
- Tab: `de-tai` (mặc định), `reels`, `binh-luan`, `so-lieu`.
- Trạng thái đề tài (đúng 5 giá trị, nhãn tiếng Việt): `chua-viet` "Chưa viết", `dang-viet` "Đang viết", `cho-sua` "Chờ sửa", `co-kich-ban` "Có kịch bản", `co-video` "Có video".
- Thêm đề tài: tiêu đề tiếng Việt + tiêu đề bài Wikipedia tiếng Anh; từ chối nếu `isSensitiveTopic(title + wiki)`; outline = `topicOutline({ title, wiki, angle: "" })`.
- Lệnh CLI mới `factcheck:<chapterId>` = `writeChapterStep(id, "finish")` (soát lại + chốt), qua `seriesCommand`.
- Không gọi AI trên Vercel từ trang này — mọi việc viết/soát dispatch sang Actions.
- Giao diện tiếng Việt có dấu; theo class sẵn có (`card`, `btn-primary`, `btn-secondary`, `field`, `text-muted`).

## Review Focus

- Chưa có bộ lịch sử trong DB → trang hiện hướng dẫn chạy `newhistory`, không lỗi 500.
- Chương lịch sử cũ chưa có `dossier` (null) → trang chương không vỡ, ghi "Chưa gom hồ sơ".
- Thêm đề tài với tiêu đề Wikipedia rỗng/chỉ khoảng trắng → báo lỗi, không lưu.
- Dispatch thiếu GH_TOKEN/GH_REPO → báo rõ "chưa cấu hình GitHub", không im lặng.
- Bấm "Viết kịch bản" hai lần liên tiếp → hai run cùng đề tài: chấp nhận (concurrency render.yml theo `video_id` đã gộp) — ghi chú trong UI "đang chạy trên GitHub, xem tab Actions".

---

### Task 1: Trạng thái đề tài + lệnh factcheck + dispatch lệnh

**Files:** Modify `src/lib/story/history.ts`, `history.test.ts`, `src/lib/story/videos.ts`, `pipeline/new-series.ts`, `pipeline/render.ts` (chỉ regex lệnh)

**Interfaces — Produces:**
- `type HistoryTopicStatus = "chua-viet" | "dang-viet" | "cho-sua" | "co-kich-ban" | "co-video"`; `HISTORY_STATUS_LABEL: Record<HistoryTopicStatus, string>`
- `historyTopicStatus(c: { status: string; content: string; factIssues: unknown }, hasVideo: boolean): HistoryTopicStatus` — `hasVideo` → co-video; `factIssues != null` → cho-sua; status draft/approved → co-kich-ban; content khác rỗng → dang-viet; còn lại chua-viet.
- `dispatchCommand(command: string): Promise<boolean>` (videos.ts) = `dispatch("render.yml", command)`.
- `seriesCommand("factcheck:<id>")` → `writeChapterStep(id, "finish")`; regex render.ts thêm `factcheck:`.

- [ ] Test `historyTopicStatus` 5 trường hợp (ưu tiên: video > chờ sửa > có kịch bản > đang viết > chưa viết).
- [ ] FAIL → cài → PASS → typecheck → commit `feat(lich-su): trạng thái đề tài + lệnh factcheck + dispatchCommand`.

### Task 2: Server actions của trang

**Files:** Modify `src/app/actions.ts`

**Interfaces — Produces:**
- `writeHistoryScriptAction(seriesId: number): Promise<ActionState>` → `dispatchCommand("historyscript:<id>")`; false → error "Chưa cấu hình GitHub (GH_TOKEN/GH_REPO) — không gọi được Actions."; ok → "Đã gửi lệnh viết kịch bản — chạy trên GitHub Actions (~15–30 phút), xong sẽ báo Telegram."
- `recheckFactsAction(chapterId: number): Promise<ActionState>` → `dispatchCommand("factcheck:<id>")`, thông điệp tương tự.
- `addHistoryTopicAction(seriesId: number, _: ActionState, form: FormData): Promise<ActionState>` — `title`, `wiki` trim; thiếu → "Cần tiêu đề và tên bài Wikipedia tiếng Anh."; nhạy cảm → "Đề tài chạm vùng nhạy cảm — kênh đã chọn né."; insert chương số kế tiếp, outline `topicOutline({ title, wiki, angle: "" })`; `revalidatePath("/lich-su")`.
- [ ] Logic kiểm đầu vào tách hàm thuần `validateHistoryTopic(title: string, wiki: string): string | null` (history.ts) + test (rỗng, nhạy cảm, hợp lệ).
- [ ] FAIL → cài → PASS → typecheck → commit `feat(lich-su): action viết kịch bản / soát lại / thêm đề tài`.

### Task 3: Trang `/lich-su` + menu

**Files:** Create `src/app/lich-su/page.tsx`, `src/components/history-tabs.tsx`; Modify `src/components/app-shell.tsx`

- Trang: tìm bộ `genre = HISTORY_GENRE` (lấy bộ đầu theo id); không có → card hướng dẫn `render.yml` với `newhistory:lich-su`.
- Đầu trang: tên kênh, số đề tài theo từng trạng thái (5 ô đếm), nút "Viết kịch bản đề tài kế" (ActionForm → writeHistoryScriptAction).
- Tab `de-tai`: bảng #, tiêu đề (link `/chapters/<id>`), badge trạng thái, số từ, số nguồn (`dossier?.sources.length`), dòng Wikipedia; form "Thêm đề tài" (2 ô + nút).
- Tab `reels` / `binh-luan` / `so-lieu`: card trạng thái trống nói rõ khi nào có dữ liệu ("Reels tự cắt từ video dài — có sau khi dựng video đầu tiên").
- `history-tabs.tsx`: thanh tab dạng link (`/lich-su?tab=…`), tab hiện tại đậm.
- [ ] Typecheck + lint; chạy `pnpm build` không cần (Vercel build) — kiểm bằng `pnpm typecheck` và mở thử local nếu có DATABASE_URL.
- [ ] Commit `feat(lich-su): trang quản lý kênh lịch sử + menu`.

### Task 4: Trang chương — nguồn tư liệu + lỗi sự thật

**Files:** Modify `src/app/chapters/[id]/page.tsx`; Create `src/components/history-dossier.tsx`

- Chỉ khi `isHistoryStory(series)`: khối "Nguồn tư liệu" (danh sách nguồn: badge loại wikipedia/wikisource/web, ngôn ngữ, tiêu đề link URL, số ký tự; `dossier` null → "Chưa gom hồ sơ — sẽ gom khi viết lượt đầu"); khối "Lỗi sự thật (chờ sửa)" khi `factIssues` có: mỗi lỗi quote / note / fix đề xuất + nút "Soát lại" (recheckFactsAction) và hướng dẫn "sửa tay đoạn sai trong nội dung rồi bấm Soát lại".
- [ ] Typecheck + lint → commit `feat(lich-su): trang chương hiện nguồn tư liệu + lỗi sự thật`.
