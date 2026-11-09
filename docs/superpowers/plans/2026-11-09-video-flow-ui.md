# Màn Flow video — Giai đoạn UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây màn flow kiểu n8n cho từng video tại `/videos/[id]`: canvas kéo thả, inspector theo node, responsive. Trang `/videos` đổi thành lưới thẻ. Giai đoạn này chỉ dùng dữ liệu đã có trong DB.

**Architecture:** Một hàm thuần `buildFlow()` suy trạng thái từng node từ dữ liệu sẵn có (`videos`, `chapters`, `series`). Trang server nạp dữ liệu thành `FlowData` (serializable) rồi truyền vào client component `FlowStudio`, dùng React Flow để vẽ canvas. Vị trí node lưu thành một bố cục chung trong bảng `app_settings`. Giai đoạn core (plan sau) sẽ cắm dữ liệu tiến độ thật vào chính `FlowData`/`buildFlow`.

**Tech Stack:** Next.js 16.4 (App Router, `cacheComponents: true`), React 19.3, Tailwind 4, Drizzle + Neon, `@xyflow/react` 12, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-video-flow-design.md` (các mục 1–3, 5, 6, 9 cùng phần "Thứ tự làm → Giai đoạn UI"). Mockup đích: `.superpowers/brainstorm/295-1794236422/content/flow-v3.html`.

## Global Constraints

- Next.js bản này khác kiến thức cũ. **Trước khi viết code Next**, chạy `pnpm install` rồi đọc guide liên quan trong `node_modules/next/dist/docs/` (route params, `connection()`, server actions, `cacheComponents`). Làm theo pattern sẵn có: page bọc `<Suspense>` + `await connection()`, `PageProps<"/route/[id]">`, `parseId()` từ `src/lib/params.ts`.
- Toàn bộ UI, comment và thông báo viết tiếng Việt có dấu. Comment ít, chỉ giải thích "vì sao" (theo style repo).
- Màn flow luôn nền tối (kiểu n8n), các trang khác giữ theme hiện tại.
- Không bịa số liệu. Dữ liệu chưa có (tiến độ từng bước, ảnh cảnh, giọng đọc, nhật ký, model từng video) phải hiện trạng thái trống rõ ràng, vd "Chưa có dữ liệu — sẽ có ở bản cập nhật pipeline".
- File tải qua `/api/videos/[id]/[file]` (đã đi qua `src/proxy.ts` đăng nhập). Không thêm đường lấy file nào khác.
- Dùng được trên điện thoại: từ 768px (`md`) trở xuống, inspector thành bottom sheet. Không chữ nào đè lên dây hay tràn khỏi node; tiêu đề dài thì cắt bằng `truncate`/`line-clamp`.
- Làm trên branch `feat/video-flow-ui`, không commit thẳng vào `main`.

## Review Focus

- **Video cũ hoặc thiếu file** (không có `short.mp4`, không có thumbnail, `meta` null vì lỗi trước khi xong): màn flow vẫn mở được, node nào thiếu thì báo thiếu chứ không crash. Test ở Task 1.
- **Bố cục đã lưu bị hỏng hoặc thiếu node** (JSON sai kiểu, thiếu khóa, có khóa lạ do sau này thêm node): dùng mặc định cho phần hỏng, giữ phần đúng. Test ở Task 2.
- **Video đang chờ vì hết quota** (`status=queued` kèm `error`): hiện là "đang chờ" màu trung tính, không phải lỗi đỏ. Test ở Task 1.
- **id sai** (`/videos/abc`, `/videos/99999`): ra trang 404, không phải trang lỗi trắng. Kiểm thủ công ở Task 3.
- **Tiêu đề tiếng Việt dài trên điện thoại** (tên truyện + chương dài, tiêu đề YouTube 100 ký tự): không tràn khung trên thẻ, node và top bar. Kiểm thủ công ở Task 3 và Task 5 tại bề rộng 390px.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/lib/flow/model.ts` (mới) | Kiểu `FlowData`, `NodeId`, `StepView`; `buildFlow()`; `formatSlot()` — thuần, không đụng DB |
| `src/lib/flow/model.test.ts` (mới) | Test `buildFlow`, `formatSlot` |
| `src/lib/flow/layout.ts` (mới) | Danh sách node, node con, cạnh nối; `DEFAULT_POSITIONS`; `mergeLayout()` thuần |
| `src/lib/flow/layout.test.ts` (mới) | Test `mergeLayout` |
| `src/lib/flow/data.ts` (mới) | `loadFlowData()`, `getFlowLayout()` — đọc DB |
| `src/db/schema.ts` (sửa) | Thêm bảng `appSettings` |
| `drizzle/0003_*.sql` (sinh) | Migration bảng `app_settings` |
| `src/app/actions.ts` (sửa) | `saveFlowLayoutAction`, `resetFlowLayoutAction` |
| `src/app/videos/[id]/page.tsx` (mới) | Trang flow: nạp dữ liệu, render `FlowStudio` |
| `src/components/flow/flow-studio.tsx` (mới) | Client: khung trang (top bar, canvas, inspector, thanh nhật ký), chọn node, lưu vị trí |
| `src/components/flow/nodes.tsx` (mới) | Custom node React Flow: `StepNode`, `AgentNode`, `SubNode` |
| `src/components/flow/inspector.tsx` (mới) | Khung inspector, tab, bottom sheet trên điện thoại |
| `src/components/flow/panels.tsx` (mới) | Nội dung từng node trong inspector, kể cả luồng đăng tay |
| `src/app/globals.css` (sửa) | Class `.flow-dark` ép palette tối cho màn flow |
| `src/app/layout.tsx` (sửa) | Header cao cố định `h-12`; menu "Truyện · Video" |
| `src/app/videos/page.tsx` (sửa) | Lưới thẻ video |
| `src/app/chapters/[id]/page.tsx` (sửa) | Nút "Xem flow" |
| `pipeline/render.ts` (sửa) | Link Telegram trỏ `/videos/${videoId}` |

---

### Task 1: Mô hình flow (thuần)

**Files:**
- Create: `src/lib/flow/model.ts`
- Test: `src/lib/flow/model.test.ts`

**Interfaces:**
- Consumes: `Video`, `VideoMeta` từ `src/db/schema.ts`.
- Produces:
  ```ts
  export type FileName = "long.mp4" | "short.mp4" | "thumbnail.jpg" | "youtube.txt";
  export type NodeId = "trigger" | "agent" | "tts" | "images" | "video" | "youtube";
  export type StepState = "wait" | "run" | "done" | "error" | "skip";
  export type StepView = { id: NodeId; title: string; subtitle: string; state: StepState; warning?: string };
  export type FlowNotice = { tone: "info" | "error"; text: string } | null;
  export type FlowData = {
    video: {
      id: number; status: Video["status"]; error: string | null; runUrl: string | null;
      publishAt: string | null; durationSec: number | null; youtubeUrl: string | null;
      meta: VideoMeta | null; files: Partial<Record<FileName, string>>; createdAt: string; updatedAt: string;
    };
    chapter: { id: number; number: number; title: string; words: number; opening: string; approvedAt: string };
    series: { id: number; title: string; bibleExcerpt: string; voiceStyle: string };
    prevSummary: string | null;
  };
  export function buildFlow(d: FlowData): { steps: Record<NodeId, StepView>; notice: FlowNotice };
  export function formatSlot(iso: string): string; // "19:00 · Th 5 12/11", giờ Asia/Ho_Chi_Minh
  ```
  Ngày giờ trong `FlowData` là chuỗi ISO, để truyền được từ server sang client.

Quy tắc trạng thái (từ spec, giai đoạn này chưa có dữ liệu từng bước). "Nhóm render" gồm `agent`, `tts`, `images`, `video`:

| `video.status` | trigger | nhóm render | youtube | notice |
|---|---|---|---|---|
| `queued`, không có `error` | done | wait | wait | null |
| `queued`, có `error` (hết quota) | done | wait | wait | `{tone:"info", text:"Đang chờ: <error>"}` |
| `rendering` | done | run, subtitle `"đang render"` | wait | null |
| `failed` | done | error | skip, subtitle `"không đăng vì render lỗi"` | `{tone:"error", text:<error>}` |
| `ready` | done | done | wait, subtitle `"chờ đăng · " + formatSlot(publishAt)`, hoặc `"chờ đăng tay"` nếu không có `publishAt` | null |
| `published` | done | done | done, subtitle `"đã đăng"` | null |

Subtitle khi một node trong nhóm render đã `done`:
- agent: có `meta` thì `"tiêu đề · Short · tag"`, không thì `"xong"`.
- tts: có `durationSec` thì `m:ss`, không thì `"xong"`.
- images: có thumbnail thì `"có thumbnail"`, không thì `"xong"`.
- video: có `short.mp4` thì `"dài + Short"`, không thì `"chỉ video dài"`. Thiếu Short khi `ready`/`published` thì thêm `warning: "Không có Short"`, nhưng state vẫn `done`.

Subtitle của trigger: `"Chương <number>"`. Tiêu đề node: `Chương đã duyệt`, `AI Agent`, `Giọng đọc`, `Vẽ ảnh cảnh`, `Dựng video`, `Đăng YouTube`.

- [ ] **Step 1: Viết test lỗi**

  Viết hàm dựng fixture `data(overrides)` cho một video `ready` đủ file. Các test:
  ```ts
  test("ready đủ file: nhóm render done, youtube chờ đăng theo lịch", () => {
    const { steps, notice } = buildFlow(data({ status: "ready", publishAt: "2026-11-12T12:00:00.000Z" }));
    expect(["agent", "tts", "images", "video"].map((k) => steps[k as NodeId].state)).toEqual(["done", "done", "done", "done"]);
    expect(steps.youtube.subtitle).toContain("19:00");
    expect(steps.video.subtitle).toBe("dài + Short");
    expect(notice).toBeNull();
  });
  test("thiếu Short: video vẫn done nhưng có cảnh báo", () => {
    const s = buildFlow(data({ status: "ready", files: { "long.mp4": "/x" } })).steps;
    expect(s.video).toMatchObject({ state: "done", subtitle: "chỉ video dài", warning: "Không có Short" });
  });
  test("failed với meta null không crash, youtube skip, notice đỏ", () => {
    const r = buildFlow(data({ status: "failed", meta: null, error: "ffmpeg chết", files: {} }));
    expect(r.steps.agent.state).toBe("error");
    expect(r.steps.youtube.state).toBe("skip");
    expect(r.notice).toEqual({ tone: "error", text: "ffmpeg chết" });
  });
  test("queued vì hết quota là chờ, không phải lỗi", () => {
    const r = buildFlow(data({ status: "queued", error: "Hết quota ảnh Cloudflare hôm nay — chờ reset 7h sáng." }));
    expect(r.steps.images.state).toBe("wait");
    expect(r.notice?.tone).toBe("info");
  });
  test("rendering: nhóm render run, trigger done", () => {
    const s = buildFlow(data({ status: "rendering" })).steps;
    expect(s.trigger.state).toBe("done");
    expect(s.tts).toMatchObject({ state: "run", subtitle: "đang render" });
  });
  test("published: youtube done", () => {
    expect(buildFlow(data({ status: "published" })).steps.youtube).toMatchObject({ state: "done", subtitle: "đã đăng" });
  });
  test("formatSlot đổi sang giờ Việt Nam", () => {
    const s = formatSlot("2026-11-12T12:00:00.000Z");
    expect(s).toContain("19:00");
    expect(s).toContain("12/11");
  });
  ```

- [ ] **Step 2: Chạy test, phải lỗi**

  Run: `pnpm install && pnpm test src/lib/flow/model.test.ts`
  Expected: FAIL vì không tìm thấy module `./model`.

- [ ] **Step 3: Viết `src/lib/flow/model.ts`** theo các interface và bảng quy tắc ở trên. `formatSlot` dùng `toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", ... })`, định dạng giống trang `/videos` hiện tại.

- [ ] **Step 4: Chạy test, phải qua**

  Run: `pnpm test src/lib/flow/model.test.ts`
  Expected: PASS 7 test.

- [ ] **Step 5: Commit**

  ```bash
  git checkout -b feat/video-flow-ui
  git add src/lib/flow/model.ts src/lib/flow/model.test.ts
  git commit -m "feat(flow): mô hình trạng thái node từ dữ liệu video"
  ```

---

### Task 2: Bố cục node và lưu vị trí

**Files:**
- Create: `src/lib/flow/layout.ts`, `src/lib/flow/layout.test.ts`
- Modify: `src/db/schema.ts` (thêm bảng), `src/app/actions.ts` (thêm 2 action)
- Create (sinh ra): `drizzle/0003_*.sql` và snapshot

**Interfaces:**
- Consumes: `NodeId` từ Task 1.
- Produces:
  ```ts
  // schema.ts
  export const appSettings = pgTable("app_settings", {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  });
  // layout.ts
  export type SubNodeId = "model" | "bible" | "summary" | "imageModel" | "label";
  export type CanvasNodeId = NodeId | SubNodeId;
  export type Pos = { x: number; y: number };
  export const MAIN_ORDER: NodeId[]; // trigger, agent, tts, images, video, youtube
  export const SUB_NODES: { id: SubNodeId; parent: NodeId; slot?: "model" | "memory" | "tool"; title: string; subtitle: string }[];
  export const DEFAULT_POSITIONS: Record<CanvasNodeId, Pos>;
  export const LAYOUT_KEY = "flow_layout";
  export function mergeLayout(saved: unknown): Record<CanvasNodeId, Pos>;
  // actions.ts
  export async function saveFlowLayoutAction(positions: Record<string, Pos>): Promise<ActionState>;
  export async function resetFlowLayoutAction(): Promise<ActionState>;
  ```

`SUB_NODES` (theo spec và mockup v3):

| id | parent | slot | title | subtitle |
|---|---|---|---|---|
| model | agent | model | Chat model | Gemini |
| bible | agent | memory | Memory | Story bible |
| summary | agent | memory | Tóm tắt | chương trước |
| imageModel | images | — | Cloudflare | FLUX |
| label | youtube | — | Nhãn AI | + lịch đăng |

`DEFAULT_POSITIONS` lấy theo toạ độ mockup v3: hàng chính ở `y=150`, node con ở `y=340`, cách đủ rộng để nhãn không đè nhau.

- [ ] **Step 1: Viết test lỗi cho `mergeLayout`**

  ```ts
  test("null hoặc sai kiểu → mặc định", () => {
    expect(mergeLayout(null)).toEqual(DEFAULT_POSITIONS);
    expect(mergeLayout("abc")).toEqual(DEFAULT_POSITIONS);
  });
  test("giữ vị trí hợp lệ, thay phần hỏng bằng mặc định, bỏ khóa lạ", () => {
    const r = mergeLayout({ tts: { x: 10, y: 20 }, images: { x: "a", y: 1 }, ghost: { x: 1, y: 1 } });
    expect(r.tts).toEqual({ x: 10, y: 20 });
    expect(r.images).toEqual(DEFAULT_POSITIONS.images);
    expect("ghost" in r).toBe(false);
  });
  test("NaN/Infinity bị loại", () => {
    expect(mergeLayout({ agent: { x: Number.NaN, y: 0 } }).agent).toEqual(DEFAULT_POSITIONS.agent);
  });
  ```

- [ ] **Step 2: Chạy test, phải lỗi**

  Run: `pnpm test src/lib/flow/layout.test.ts`
  Expected: FAIL vì không có module.

- [ ] **Step 3: Viết `layout.ts`**, thêm `appSettings` vào `schema.ts`, rồi sinh migration bằng `pnpm db:generate` (không cần DB thật). Mở file `drizzle/0003_*.sql` xem lại: chỉ được có `CREATE TABLE "app_settings"`.

- [ ] **Step 4: Thêm 2 action vào `src/app/actions.ts`**
  - `saveFlowLayoutAction`: chạy `mergeLayout` để lọc dữ liệu, rồi upsert `app_settings` key `LAYOUT_KEY` (`onConflictDoUpdate`). Không gọi `revalidatePath`, vì client đã giữ vị trí nên không cần render lại.
  - `resetFlowLayoutAction`: xóa key đó rồi `revalidatePath("/videos", "layout")`.
  - Cả hai bọc trong `attempt()` như các action khác.

- [ ] **Step 5: Chạy test và kiểm tra kiểu**

  Run: `pnpm test && pnpm typecheck`
  Expected: mọi test PASS, typecheck không lỗi.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/flow/layout.ts src/lib/flow/layout.test.ts src/db/schema.ts src/app/actions.ts drizzle/
  git commit -m "feat(flow): bố cục node mặc định + lưu vị trí chung"
  ```

---

### Task 3: Trang flow và canvas kéo thả

**Files:**
- Create: `src/lib/flow/data.ts`, `src/app/videos/[id]/page.tsx`, `src/components/flow/flow-studio.tsx`, `src/components/flow/nodes.tsx`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`, `package.json` (thêm `@xyflow/react`)

**Interfaces:**
- Consumes: `FlowData`, `buildFlow`, `formatSlot` (Task 1); `MAIN_ORDER`, `SUB_NODES`, `mergeLayout`, `LAYOUT_KEY`, `saveFlowLayoutAction`, `resetFlowLayoutAction`, `rerenderAction` (Task 2 và code sẵn có).
- Produces:
  ```ts
  // data.ts
  export async function loadFlowData(videoId: number): Promise<FlowData | null>;
  export async function getFlowLayout(): Promise<Record<CanvasNodeId, Pos>>;
  // flow-studio.tsx
  export function FlowStudio(props: { data: FlowData; layout: Record<CanvasNodeId, Pos> }): JSX.Element;
  // Inspector được cắm vào ở Task 4 qua prop:
  //   <Inspector data={data} steps={steps} selected={selected} onClose={...} />
  ```

`loadFlowData`:
- Join `videos → chapters → series`.
- Lấy `summary` của chương liền trước, cùng bộ, số chương = `number - 1`.
- Dựng các trường sau:
  - `files[name] = "/api/videos/<id>/<name>"` cho những file có trong `assets`.
  - `words`: đếm như ở trang chương.
  - `opening`: 400 ký tự đầu của nội dung chương.
  - `bibleExcerpt`: 600 ký tự đầu của story bible.
  - `approvedAt`: lấy `chapters.updatedAt`.
- Không tìm thấy video thì trả `null`.

- [ ] **Step 1: Cài React Flow và đọc tài liệu**

  Run: `pnpm add @xyflow/react@^12`
  Đọc `node_modules/next/dist/docs/` phần dynamic route params và `connection`. Đọc README của `@xyflow/react` về custom nodes, `onNodeDragStop`, `fitView`. Import CSS: `@xyflow/react/dist/style.css`.

- [ ] **Step 2: Header cố định và palette tối**
  - `layout.tsx`:
    - Header đặt `h-12`, nav đặt `h-full` và bỏ `py-3`.
    - Thêm link "Truyện" trỏ `/` cạnh logo; link "Video" giữ nguyên.
  - `globals.css`: thêm class `.flow-dark`, gán lại các biến `--background --foreground --muted --border --card --accent` bằng đúng giá trị của khối dark hiện có. Nhờ vậy `CopyButton`, `ActionForm` và `.btn-*` tự hiện đúng màu trên màn flow.

- [ ] **Step 3: Viết `data.ts` và `src/app/videos/[id]/page.tsx`**
  - Làm theo pattern của `chapters/[id]/page.tsx`:
    - Bọc `<Suspense>`, gọi `await connection()`.
    - Lấy id bằng `parseId`, không có dữ liệu thì `notFound()`.
    - Nạp `loadFlowData` và `getFlowLayout` song song.
  - Phần tử gốc của trang: `className="flow-dark fixed inset-x-0 bottom-0 top-12 z-10 bg-[#0d0d10] text-foreground"`. Nó phủ đúng vùng dưới header, thoát khỏi khung `max-w-5xl`.

- [ ] **Step 4: Viết `nodes.tsx`**, gồm 3 node type cho React Flow, phong cách theo mockup v3:
  - `StepNode`: ô vuông 84px, icon, badge trạng thái ở góc, handle trái/phải. Nhãn ở dưới: title đậm, subtitle mờ, cắt bằng `truncate` trong khung rộng 150px.
  - `AgentNode`: thẻ rộng 230px, tông tím, 3 handle dưới có nhãn `Model*` / `Memory` / `Tool`.
  - `SubNode`: hình tròn 52px, handle ở trên.
  - Màu viền theo state:
    - `done`: xanh lá.
    - `run`: xanh dương phát sáng.
    - `error`: đỏ.
    - `wait`: mờ đi (`opacity-60`).
    - `skip`: xám, chữ gạch.
    - Có `warning`: thêm chấm vàng.
  - Icon dùng emoji như mockup.

- [ ] **Step 5: Viết `flow-studio.tsx`** (`"use client"`)
  - **Top bar:**
    - Breadcrumb `<tên truyện> › Video #<id>` link về trang truyện.
    - Tiêu đề `Chương N · <title>` (`truncate`).
    - Pill trạng thái.
    - Pill lịch đăng nếu có `publishAt`.
    - Nút "Render lại" dùng `ActionForm` + `rerenderAction`, hiện khi status là `failed`, `ready` hoặc `queued` (giống `/videos` hiện tại).
    - Link "Log render" nếu có `runUrl`.
  - **Canvas** `<ReactFlow>`:
    - `nodes` dựng từ `MAIN_ORDER` + `SUB_NODES` với vị trí từ `layout`. `edges`: các cạnh liền giữa node chính, cạnh đứt nét từ node cha xuống node con.
    - Cạnh đi vào node đang `run` có `animated`.
    - `fitView`, `<Background variant="dots">`, `<Controls>`, `proOptions={{ hideAttribution: true }}`.
    - Không cho nối dây: `nodesConnectable={false}`.
  - **Kéo thả:** `onNodeDragStop` gom vị trí mọi node rồi gọi `saveFlowLayoutAction`. Có nút "Sắp xếp lại" gọi `resetFlowLayoutAction`, sau đó đặt lại vị trí về `DEFAULT_POSITIONS` và chạy `fitView`.
  - **Chọn node:** bấm node thì `selected = id`; mặc định chọn node đầu tiên không `done`, nếu tất cả đã xong thì chọn `video`. Node con khi bấm sẽ chọn node cha của nó.
  - **Notice:** nếu `notice` khác null, hiện băng ngay dưới top bar (`info` màu xanh dương nhạt, `error` màu đỏ), cắt bớt khoảng 300 ký tự.
  - **Thanh nhật ký dưới cùng:**
    - Giờ tạo video, giờ cập nhật cuối kèm trạng thái.
    - Lỗi nếu có.
    - Dòng mờ: "Nhật ký từng bước sẽ có ở bản cập nhật pipeline".
  - **Bố cục:** grid `[1fr_380px]` trên `md`. Tạm thời để chỗ inspector là một `<aside>` trống, Task 4 sẽ thay.

- [ ] **Step 6: Kiểm tra máy**

  Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  Expected: tất cả qua. `build` không có `DATABASE_URL` thì bỏ qua migration, đây là hành vi đúng.

- [ ] **Step 7: Kiểm tra bằng mắt**

  Cần `DATABASE_URL`: lấy bằng `pnpm dlx vercel env pull .env.local` nếu đã link, không có thì nhờ người dùng. Chạy `pnpm dev`, đăng nhập rồi mở `/videos/<id thật>`.
  - Kéo được node.
  - F5 xong vị trí vẫn giữ.
  - "Sắp xếp lại" đưa node về chỗ cũ.
  - Không chữ nào đè lên dây.
  - `/videos/abc` và `/videos/99999` ra trang 404.
  - Ở bề rộng 390px: top bar không tràn ngang, canvas chụm 2 ngón để zoom được.

  Không có DB thì ghi rõ bước này bị bỏ qua trong báo cáo.

- [ ] **Step 8: Commit**

  ```bash
  git add package.json pnpm-lock.yaml src/lib/flow/data.ts src/app/videos/[id] src/components/flow src/app/layout.tsx src/app/globals.css
  git commit -m "feat(flow): trang flow video với canvas kéo thả kiểu n8n"
  ```

---

### Task 4: Inspector theo từng node

**Files:**
- Create: `src/components/flow/inspector.tsx`, `src/components/flow/panels.tsx`
- Modify: `src/components/flow/flow-studio.tsx` (thay `<aside>` tạm bằng `<Inspector>`)

**Interfaces:**
- Consumes: `FlowData`, `StepView`, `NodeId` (Task 1); `CopyButton`, `ActionForm`, `markPublishedAction` (code sẵn có).
- Produces:
  ```ts
  export function Inspector(props: { data: FlowData; steps: Record<NodeId, StepView>; selected: NodeId; onClose: () => void }): JSX.Element;
  ```

Nội dung từng node. Tab "Kết quả" là chính; tab "Đầu vào / Prompt" và "Nhật ký" hiện nội dung nếu có, không thì hiện trạng thái trống:

| Node | Kết quả | Đầu vào / Prompt | Nhật ký |
|---|---|---|---|
| trigger | tiêu đề, số chữ, giờ duyệt, `opening`, link "Mở chương" → `/chapters/<id>` | — | — |
| agent | `meta.title`, `meta.description` (cắt, có nút xem thêm), chip tag, `meta.shortTitle`. `meta` null thì trống | `bibleExcerpt`, `prevSummary` (null thì ghi "Chương đầu — chưa có tóm tắt") | trống |
| tts | trống: "Chưa lưu file giọng đọc"; `durationSec` nếu có; `voiceStyle` | trống | trống |
| images | thumbnail thật (`files["thumbnail.jpg"]`), bấm thì lightbox; lưới ảnh cảnh hiện trạng thái trống | trống | trống |
| video | `<video controls preload="metadata">` cho `long.mp4`; khung dọc 9:16 cho `short.mp4`; nút tải từng file; thiếu file thì ghi thiếu | — | `error` + link `runUrl` nếu có |
| youtube | thẻ xem trước kiểu YouTube (thumbnail + tiêu đề + thời lượng), lịch đăng (`formatSlot`), `youtubeUrl` nếu có. **Luồng đăng tay:** các nút copy tiêu đề/mô tả/tag/tiêu đề Short, form "Đã đăng" + ô link YouTube (khi status `ready`), y như trang `/videos` hiện tại | — | — |

- [ ] **Step 1: Viết `inspector.tsx`**
  - Header gồm icon, title, dòng trạng thái theo kiểu `"Đã xong · <subtitle>"`.
  - 3 tab, đổi node thì về tab đầu.
  - Trên `md` trở lên: cột phải rộng 380px, có thanh cuộn riêng.
  - Dưới `md`: bottom sheet `fixed inset-x-0 bottom-0`.
    - Mặc định thu gọn còn một thanh 56px hiện tên node.
    - Bấm thanh hoặc chọn node thì mở cao `70dvh`.
    - Nút ✕ gọi `onClose` để thu lại.

- [ ] **Step 2: Viết `panels.tsx`**
  - Mỗi node một component, nội dung theo bảng trên.
  - Có component `Empty({ text })` dùng chung cho mọi trạng thái trống.
  - Lightbox: overlay `fixed` với ảnh `object-contain`, đóng bằng click nền hoặc phím Esc.

- [ ] **Step 3: Cắm vào `flow-studio.tsx`.** Chọn node trên điện thoại thì mở sheet.

- [ ] **Step 4: Kiểm tra máy**

  Run: `pnpm typecheck && pnpm lint && pnpm test`
  Expected: qua hết.

- [ ] **Step 5: Kiểm tra bằng mắt** (có DB)

  Mở lần lượt một video `ready`, một video `failed` và một video cũ thiếu Short.
  - Bấm từng node, không node nào làm trang lỗi.
  - Video phát được.
  - Copy tiêu đề chạy.
  - Ở 390px: sheet mở/đóng mượt và không che mất top bar.

- [ ] **Step 6: Commit**

  ```bash
  git add src/components/flow
  git commit -m "feat(flow): inspector chi tiết từng node + luồng đăng tay"
  ```

---

### Task 5: Lưới thẻ `/videos` và các lối vào

**Files:**
- Modify: `src/app/videos/page.tsx`, `src/app/chapters/[id]/page.tsx`, `pipeline/render.ts`

**Interfaces:**
- Consumes: `buildFlow`/`formatSlot` (Task 1) để dùng chung nhãn trạng thái. Route `/videos/[id]` (Task 3).
- Produces: không có.

- [ ] **Step 1: Viết lại `src/app/videos/page.tsx` thành lưới thẻ**
  - Giữ câu hướng dẫn đăng tay ở đầu trang, rút ngắn lại.
  - Lưới: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`.
  - Mỗi thẻ là một `Link` tới `/videos/<id>`, gồm:
    - Ảnh `thumbnail.jpg` tỉ lệ 16:9. Thiếu thumbnail thì dùng nền gradient kèm số chương.
    - Pill trạng thái, giữ đúng nhãn và màu của map `STATUS` hiện có.
    - Tên truyện và `Chương N: title` (`line-clamp-2`).
    - Lịch đăng (`formatSlot`) hoặc thời lượng.
  - Video `rendering` có thanh chạy vô định (`animate-pulse`), không hiện số.
  - Giữ giới hạn 50.
  - Các nút tải, copy, "Render lại", "Đã đăng" chuyển hết vào màn flow, bỏ khỏi thẻ.

- [ ] **Step 2: Thêm nút "Xem flow" vào trang chương.** Chương đã duyệt và có video thì hiện nút; video nào có `id` lớn nhất thì dùng video đó. Lấy video trong cùng `Promise.all` đang có.

- [ ] **Step 3: Sửa link Telegram trong `pipeline/render.ts`.** Hai chỗ `👉 ${WEB_URL}/videos` (báo sẵn sàng và báo lỗi) đổi thành `👉 ${WEB_URL}/videos/${videoId}`.

- [ ] **Step 4: Kiểm tra máy**

  Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
  Expected: qua hết.

- [ ] **Step 5: Kiểm tra bằng mắt** (có DB)
  - `/videos` hiện lưới thẻ có thumbnail; bấm thẻ thì vào màn flow.
  - Tiêu đề dài không tràn thẻ ở bề rộng 390px.
  - Trang chương đã duyệt có nút "Xem flow".

- [ ] **Step 6: Commit**

  ```bash
  git add src/app/videos/page.tsx src/app/chapters pipeline/render.ts
  git commit -m "feat(videos): lưới thẻ video, lối vào màn flow từ chương và Telegram"
  ```
