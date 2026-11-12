# Bấm vào là cuốn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Truyện + video mở đầu bằng xung đột/lời hứa trong 20 giây đầu, Thần Ấn Thôn Phệ thành "hệ thống" có thông báo thưởng, tiêu đề/thumbnail nói ra bàn tay vàng.

**Architecture:** Sửa prompt viết (`src/lib/story/prompts.ts`), thêm lớp biên tập viên AI chấm 300 từ đầu ngay sau lượt viết đầu (`src/lib/story/editor.ts` + `service.ts`), một lệnh vận hành ghi luật "hệ thống" vào bible series 4 và trả các chương chưa có video về dàn ý để viết lại theo luật mới, bỏ đọc tên chương ở render, sửa mô tả schema meta/cold open, thumbnail nhận ảnh mẫu nam chính.

**Tech Stack:** TypeScript, Next.js (app chỉ dùng cho trang web; pipeline chạy `tsx` trên GitHub Actions), drizzle + Neon, zod, vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-12-hook-he-thong-design.md`

## Global Constraints

- Ngôn ngữ chú thích/log/commit: tiếng Việt có dấu đầy đủ (theo code hiện có).
- Không thêm phụ thuộc mới. Không đổi schema DB.
- Không tốn thêm lượt giọng đọc: biên tập viên chạy trước TTS; không render lại chương đã có video.
- Biên tập viên dùng `tier: "cheap"`, `task: "summary"` (chấm) — viết lại mở đầu dùng `task: "story"`. Tối đa **2** lượt viết lại; không đạt vẫn giữ bản tốt nhất, không chặn pipeline.
- "300 từ đầu" = 300 từ đếm bằng `wordCount` hiện có.
- Mỗi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Kiểm tra trước mỗi commit: `pnpm exec vitest run` (toàn bộ pass) và `pnpm exec tsc --noEmit` (exit 0).

## Review Focus

1. Chương ngắn hơn 300 từ / nội dung rỗng → biên tập viên không crash, coi cả chương là phần mở đầu. (Test ở Task 2.)
2. AI chấm trả JSON hỏng hoặc lỗi mạng/hết quota → bỏ qua bước chấm, giữ bản gốc, KHÔNG nuốt `QuotaExhaustedError` (để daily dừng như cũ). (Test ở Task 2.)
3. Bản viết lại mở đầu bị AI chép luôn phần thân → chỉ thay đúng phần mở đầu, không nhân đôi nội dung chương. (Test ở Task 2.)
4. Chạy lệnh `hethong:4` hai lần → bible không bị chèn mục hệ thống hai lần; chương đã có video không bị đụng. (Test ở Task 3.)
5. Tag/tiêu đề cũ trong `meta` vẫn có tên nhân vật → không làm hỏng render (chỉ là prompt, không có validator chặn). Không cần test — ghi nhận.

---

### Task 1: Luật viết mới trong prompt

**Files:**
- Modify: `src/lib/story/prompts.ts` (`WRITER_SYSTEM`, `chapterPrompt`, `openerLine`)
- Test: `src/lib/story/prompts.test.ts`

**Interfaces:**
- Produces: `export const OPENING_RULES: string[]` — đúng 6 dòng luật mở đầu (dùng lại ở Task 2 làm checklist chấm).

- [ ] **Step 1: Viết test hỏng** trong `prompts.test.ts`:

```ts
describe("luật mở đầu kiểu truyện hệ thống", () => {
  it("prompt chương có đủ luật mở đầu và bỏ luật tả giác quan", () => {
    const p = chapterPrompt(s, [ch(1)], ch(2));
    for (const rule of OPENING_RULES) expect(p.system + p.prompt).toContain(rule);
    expect(p.prompt).not.toContain("mùi máu, tiếng xương gãy");
    expect(p.system).not.toContain("Tả bằng giác quan");
  });
  it("mẫu học là truyện audio hệ thống, không còn nêu tên 3 bộ truyện chữ", () => {
    expect(chapterPrompt(s, [], ch(1)).system).not.toMatch(/Đấu La|Thôn Phệ Tinh Không|Quang Âm Chi Ngoại/);
  });
  it("chương mở tập: câu đầu là thông báo bàn tay vàng hoặc thoại xung đột", () => {
    expect(openerLine({ episodeChapters: 3 }, 1, 3)).toMatch(/câu đầu tiên/i);
  });
});
```

- [ ] **Step 2: Chạy** `pnpm exec vitest run src/lib/story/prompts.test.ts` → FAIL (`OPENING_RULES` chưa có).

- [ ] **Step 3: Sửa `prompts.ts`.** `OPENING_RULES` nguyên văn:

```ts
export const OPENING_RULES = [
  "Câu đầu tiên là lời thoại xung đột, lời thông báo của bàn tay vàng, hoặc một câu nêu điều khác biệt — dưới 20 từ; KHÔNG tả cảnh, thời tiết, tên truyện, tên chương.",
  "Trong 300 từ đầu có xung đột trực tiếp giữa người với người (sỉ nhục, đe doạ, thách thức).",
  "Trong 300 từ đầu nhắc tới bàn tay vàng của nhân vật chính và hứa hẹn sức mạnh của nó.",
  "Trong 300 từ đầu có một câu hỏi tò mò nói thành lời (nhân vật hỏi, hoặc người kể hỏi người nghe).",
  "Hai phút đầu (≈300 từ) lời thoại chiếm hơn một nửa; không quá 2 câu tả cảnh liền nhau.",
  "Câu tả cảnh ≤ 15 từ, tối đa 1 hình ảnh so sánh (\"như…\") mỗi đoạn; không chồng tính từ.",
];
```

`WRITER_SYSTEM`: đổi đoạn mở "lối viết gây nghiện học từ Đấu La…" thành mô tả mẫu là **truyện audio hệ thống/sảng văn** (nhân vật có bàn tay vàng nói ra sớm, phần thưởng đo được xuất hiện đều đặn, thoại nhiều, câu ngắn); giữ dòng "Sức mạnh đo được bằng con số…". Thêm dòng: "Cứ khoảng 600–800 từ có một lần nhân vật chính được thưởng (con số tăng, kỹ năng mở khoá, vật phẩm) hoặc một cú lật." Thay dòng "Câu tả cảnh tối đa ~20 từ…" bằng `OPENING_RULES` (nối bằng `\n- `) dưới tiêu đề `MỞ ĐẦU CHƯƠNG (300 từ đầu quyết định người nghe ở lại):`. `chapterPrompt`: xoá gạch đầu dòng "Tả bằng giác quan cụ thể (mùi máu, tiếng xương gãy, hơi lạnh của sát khí)…"; đổi "Thoại chiếm khoảng 1/3" → "Thoại chiếm khoảng 40% cả chương, hơn một nửa ở 300 từ đầu". `openerLine`: đổi "mở bằng biến cố lớn ngay câu đầu" → "câu đầu tiên là lời thông báo của bàn tay vàng hoặc thoại xung đột, ngay sau đó nêu điều khác biệt của nhân vật chính trong 1–2 câu". Sửa test cũ `biblePrompt` nếu nó kiểm tên 3 bộ (HIT_FORMULA giữ nguyên cho `biblePrompt` — chỉ `WRITER_SYSTEM` bỏ tên).

- [ ] **Step 4: Chạy** `pnpm exec vitest run src/lib/story/prompts.test.ts` → PASS; rồi cả bộ + `tsc`.

- [ ] **Step 5: Commit** `feat(story): luật mở đầu kiểu truyện hệ thống — câu đầu là xung đột, bỏ văn chồng tính từ`.

---

### Task 2: Biên tập viên AI chấm 300 từ đầu

**Files:**
- Create: `src/lib/story/editor.ts`
- Create: `src/lib/story/editor.test.ts`
- Modify: `src/lib/story/service.ts` (`writeChapterStep`, nhánh `mode === "start"`)
- Modify: `pipeline/daily.ts` (`writeNext`: gửi `notify` khi có cảnh báo)

**Interfaces:**
- Consumes: `OPENING_RULES` (Task 1), `wordCount` (`prompts.ts`), `textProvider().generateJson/generateText`.
- Produces:
  - `export const OPENING_WORDS = 300`
  - `export function splitOpening(content: string, words = OPENING_WORDS): { opening: string; rest: string }` — cắt theo đoạn (`\n\n`): gom đoạn tới khi ≥ `words` từ; `rest` là phần còn lại (có thể rỗng).
  - `export const reviewSchema = z.object({ pass: z.boolean(), failed: z.array(z.number().int()) /* chỉ số 0-based trong OPENING_RULES */ , note: z.string() })`
  - `export function reviewPrompt(opening: string): { system: string; prompt: string }`
  - `export function rewriteOpeningPrompt(base: { system: string; prompt: string }, opening: string, failed: number[]): { system: string; prompt: string }` — yêu cầu viết lại CHỈ đoạn mở đầu, cùng diễn biến, khoảng cùng số từ, sửa đúng các luật `failed`.
  - `export function replaceOpening(content: string, newOpening: string): string` — `newOpening.trim() + "\n\n" + rest`; nếu `newOpening` chứa nguyên văn đoạn đầu tiên của `rest` (AI chép luôn thân) thì cắt `newOpening` tại chỗ đó.
  - `export async function polishOpening(content: string, base: {system: string; prompt: string}): Promise<{ content: string; warning: string | null }>` — chấm; không đạt → viết lại tối đa 2 lần, mỗi lần chấm lại; trả bản cuối đạt, hoặc bản có ít `failed` nhất kèm `warning` (vd `"Mở đầu chưa đạt sau 2 lần viết lại: <tóm tắt luật hỏng>"`). Lỗi chấm (JSON hỏng/mạng) → trả `content` gốc, `warning: null`. `QuotaExhaustedError` → ném lại.
- `writeChapterStep` trả thêm `warning?: string | null` (chỉ nhánh `start`).

- [ ] **Step 1: Viết test hỏng** `editor.test.ts` (chỉ hàm thuần, không gọi AI):

```ts
it("splitOpening gom đoạn tới ≥300 từ", () => {
  const para = (n: number) => Array(n).fill("từ").join(" ");
  const { opening, rest } = splitOpening([para(200), para(150), para(100)].join("\n\n"));
  expect(wordCount(opening)).toBe(350);
  expect(wordCount(rest)).toBe(100);
});
it("splitOpening chương ngắn hơn 300 từ: cả chương là mở đầu", () => {
  expect(splitOpening("ngắn thôi")).toEqual({ opening: "ngắn thôi", rest: "" });
  expect(splitOpening("")).toEqual({ opening: "", rest: "" });
});
it("replaceOpening thay đúng phần mở đầu", () => {
  const c = `${"a ".repeat(300)}\n\nthân chương`;
  expect(replaceOpening(c, "mở đầu mới")).toBe("mở đầu mới\n\nthân chương");
});
it("replaceOpening: AI chép luôn thân thì không nhân đôi", () => {
  const c = `${"a ".repeat(300)}\n\nthân chương dài`;
  expect(replaceOpening(c, "mở đầu mới\n\nthân chương dài")).toBe("mở đầu mới\n\nthân chương dài");
});
it("reviewPrompt liệt kê đủ luật có đánh số và kèm đoạn mở đầu", () => {
  const p = reviewPrompt("Câu mở.");
  OPENING_RULES.forEach((r, i) => expect(p.prompt).toContain(`${i}. ${r}`));
  expect(p.prompt).toContain("Câu mở.");
});
it("rewriteOpeningPrompt chỉ nêu luật hỏng", () => {
  const p = rewriteOpeningPrompt({ system: "S", prompt: "P" }, "mở", [0, 3]);
  expect(p.prompt).toContain(OPENING_RULES[0]);
  expect(p.prompt).toContain(OPENING_RULES[3]);
  expect(p.prompt).not.toContain(OPENING_RULES[1]);
});
```

Thêm test `polishOpening` với provider giả: dùng `vi.mock("@/lib/ai", …)` để `textProvider()` trả object có `generateJson` / `generateText` giả — 3 ca: (a) chấm đạt ngay → nội dung giữ nguyên, `warning` null, `generateText` không gọi; (b) chấm hỏng 3 lần → gọi viết lại đúng 2 lần, có `warning`; (c) `generateJson` ném `Error("bad json")` → giữ nguyên, `warning` null; (d) ném `QuotaExhaustedError` → `polishOpening` reject với lỗi đó.

- [ ] **Step 2: Chạy** `pnpm exec vitest run src/lib/story/editor.test.ts` → FAIL.
- [ ] **Step 3: Viết `editor.ts`** theo Interfaces. Chấm: `generateJson({ ...reviewPrompt(opening), schema: reviewSchema, temperature: 0.2, tier: "cheap", task: "summary" })`. Viết lại: `generateText({ ...rewriteOpeningPrompt(...), maxOutputTokens: 4000, temperature: 0.8, task: "story" })`.
- [ ] **Step 4: Nối vào `service.ts`**: trong nhánh `mode === "start"`, sau khi có `part`, `const polished = await polishOpening(part, base); content = polished.content;` rồi lưu như cũ; trả `warning: polished.warning`. `daily.ts` `writeNext`: nếu `r.warning` của lượt `start` khác null → `console.warn` + `notify(\`⚠️ Chương ${next.number}: ${r.warning}\`)`.
- [ ] **Step 5: Chạy** cả bộ test + `tsc` → PASS.
- [ ] **Step 6: Commit** `feat(story): biên tập viên AI chấm 300 từ đầu, viết lại mở đầu tối đa 2 lần trước khi đọc giọng`.

---

### Task 3: Thần Ấn thành "hệ thống" — lệnh `hethong:<seriesId>`

**Files:**
- Create: `src/lib/story/system.ts`, `src/lib/story/system.test.ts`
- Create: `pipeline/he-thong.ts`
- Modify: `pipeline/render.ts` (CLI: thêm `if (arg.startsWith("hethong:")) return import("./he-thong").then((x) => x.applySystem(Number(arg.slice(8))));`)

**Interfaces:**
- Produces:
  - `export const SYSTEM_MARK = "## THẦN ẤN — HỆ THỐNG"`
  - `export const SYSTEM_SECTION: string` — bắt đầu bằng `SYSTEM_MARK`; nội dung (nguyên ý, Claude soạn câu chữ): Thần Ấn Thôn Phệ thức tỉnh linh trí ở **chương mở tập kế tiếp được viết** (sự kiện: lần đầu lên tiếng trong thức hải sau khi Lâm Uyên suýt chết); từ đó mỗi lần thôn phệ, Thần Ấn báo theo khuôn cố định `"Thôn phệ thành công. <tên>. <chỉ số> cộng <số>. Hiện tại: <tổng>."` và mở khoá theo khuôn `"Thần Ấn tầng <n> mở khoá: <tên thần thông> — <công dụng 1 câu>."`; số viết bằng chữ cho dễ đọc to; nhịp ~600–800 từ một lần, không quá 1 thông báo/đoạn; giới hạn: nuốt thứ mạnh hơn mình quá một đại cảnh giới thì phản phệ (mất máu, mất chỉ số tạm thời); Thần Ấn ít lời, lạnh lùng, đôi khi châm chọc — không thay Lâm Uyên quyết định; chỉ số hiện tại phải ghi trong tóm tắt mỗi chương.
  - `export const SYSTEM_STYLE = "Kể ngôi thứ ba, nhịp nhanh, thoại nhiều; lời Thần Ấn là câu ngắn theo khuôn cố định."`
  - `export function withSystemSection(bible: string): string` — idempotent: đã có `SYSTEM_MARK` thì trả nguyên.
  - `export function resettableChapters<C extends { id: number; number: number; status: string }>(list: C[], chapterIdsWithVideo: Set<number>): C[]` — chương có `status` khác `"outline"`, CHƯA có video nào, và số chương lớn hơn số chương lớn nhất đã có video.
- `pipeline/he-thong.ts`: `export async function applySystem(seriesId: number): Promise<void>` — `loadSecrets(true)`; cập nhật `series.bible = withSystemSection(bible)`, `series.style = SYSTEM_STYLE`; lấy `resettableChapters` → set `content: "", summary: "", status: "outline"` (giữ `outline`), log từng chương bị trả về. In tổng kết.

- [ ] **Step 1: Viết test hỏng** `system.test.ts`:

```ts
it("withSystemSection chèn đúng một lần", () => {
  const once = withSystemSection("bible cũ");
  expect(once.startsWith("bible cũ")).toBe(true);
  expect(once).toContain(SYSTEM_MARK);
  expect(withSystemSection(once)).toBe(once);
});
it("SYSTEM_SECTION có khuôn thông báo và luật phản phệ", () => {
  expect(SYSTEM_SECTION).toContain("Thôn phệ thành công.");
  expect(SYSTEM_SECTION).toMatch(/phản phệ/);
});
it("resettableChapters chỉ lấy chương đã viết, chưa có video, sau chương có video cuối", () => {
  const list = [17, 18, 19, 20, 21].map((n) => ({ id: n, number: n, status: n === 21 ? "outline" : "draft" }));
  const got = resettableChapters(list, new Set([17, 18]));
  expect(got.map((c) => c.number)).toEqual([19, 20]);
});
it("resettableChapters: chương chưa video nằm TRƯỚC chương có video thì giữ", () => {
  const list = [{ id: 1, number: 1, status: "draft" }, { id: 2, number: 2, status: "approved" }];
  expect(resettableChapters(list, new Set([2]))).toEqual([]);
});
```

- [ ] **Step 2: Chạy** → FAIL. **Step 3:** viết `system.ts`, `he-thong.ts`, dòng CLI. **Step 4:** test + `tsc` → PASS.
- [ ] **Step 5: Commit** `feat(story): Thần Ấn Thôn Phệ thành hệ thống — lệnh hethong:<series> ghi luật vào bible, trả chương chưa có video về dàn ý`.

---

### Task 4: Bỏ đọc tên truyện/tên chương ở đầu video

**Files:**
- Modify: `pipeline/render.ts:826-827`
- Create: `pipeline/narration.test.ts` (nếu tách hàm) — hoặc thêm vào test có sẵn của render nếu có.

**Interfaces:**
- Produces: `export function chapterNarration(content: string): string` trong `pipeline/narration.ts` (thuần, không import gì nặng) — trả `content.trim()`.

- [ ] **Step 1: Test hỏng**: `expect(chapterNarration("  Câu đầu.  ")).toBe("Câu đầu.")` và `expect(chapterNarration("Câu đầu.")).not.toMatch(/^.*Chương \d+/)`.
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** tạo hàm; `render.ts`: xoá `intro`, `const longText = chapterNarration(c.content);`. `titleCard` giữ nguyên (tên vẫn hiện bằng chữ). **Step 4:** test + `tsc` → PASS.
- [ ] **Step 5: Commit** `fix(render): không đọc tên truyện/tên chương ở đầu video — điểm rơi người xem giây 10–20`.

---

### Task 5: Cold open, tiêu đề, chữ thumbnail nói ra bàn tay vàng

**Files:**
- Modify: `pipeline/episode.ts:48-60` (`title`, `thumbnailText`, `coldOpen`, `hookText` describe)
- Modify: `pipeline/prompts.ts:11-18` (`title`, `shortTitle`, `thumbnailText`)
- Modify: `pipeline/compile.ts:35-39`, `src/lib/seo-optimize.ts:11-14` (`title`, `shortTitle`)
- Modify: `pipeline/rethumb.ts` (schema `thumbnailText`)
- Test: `pipeline/episode-plan.test.ts` hoặc test mới `pipeline/meta-rules.test.ts`

**Interfaces:**
- Produces: `export const NO_NAME_RULE = "KHÔNG dùng tên nhân vật (người mới không biết là ai) — nói hành động/cơ chế/con số"` và `export const HOOK_TITLE_RULE = "mở bằng bàn tay vàng + con số hoặc đối tượng (vd 'Nuốt Huyết Lang Vương, Một Quyền 1.200 Cân'), không mở bằng tên nhân vật"` trong `pipeline/meta-rules.ts`; các `.describe()` ở trên nối các hằng này vào.

- [ ] **Step 1: Test hỏng** (`meta-rules.test.ts`): với từng schema (`episodeSchema` cần export từ `episode.ts` — thêm `export`; `metaSchema` của `prompts.ts`; schema trong `compile.ts`, `seo-optimize.ts`, `rethumb.ts` — export nếu chưa), kiểm `shape.thumbnailText.description` chứa `NO_NAME_RULE` và `shape.title.description` chứa `HOOK_TITLE_RULE`; `episodeSchema.shape.coldOpen.description` chứa `"3–20 giây"` và `"Lâm Uyên thì khác"` KHÔNG có (không gắn cứng tên truyện vào code chung — dùng mẫu "Người khác… <nhân vật chính> thì khác").
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** tạo `meta-rules.ts`, sửa các describe. `coldOpen` mô tả mới: 0–3 giây câu bùng nổ (ưu tiên lời thông báo bàn tay vàng hoặc thoại đỉnh điểm); 3–20 giây một câu nêu khác biệt theo mẫu "Người khác … <nhân vật chính> thì khác: … hôm nay …"; còn lại khoảnh khắc gay cấn nhất, dừng trước kết quả, câu cuối gợi tò mò; tổng 85–120 từ; vẫn KHÔNG đọc tên truyện/chào hỏi. `hookText` thêm: ưu tiên cơ chế + con số (vd "+300 CÂN", "NUỐT CỔ THẦN"), theo `NO_NAME_RULE`. **Step 4:** test + `tsc` → PASS.
- [ ] **Step 5: Commit** `feat(seo): tiêu đề, chữ thumbnail, mở đầu tập nói ra bàn tay vàng — cấm tên nhân vật`.

---

### Task 6: Thumbnail gửi kèm ảnh mẫu nam chính

**Files:**
- Modify: `pipeline/render.ts:579-597` (`thumbnail`)
- Modify: `pipeline/episode.ts:240` (`makeThumbnails`), `pipeline/rethumb.ts`
- Test: `pipeline/thumb-plan.test.ts` (hoặc test mới nếu cần mock)

**Interfaces:**
- Consumes: `heroRef(s, dir): Promise<{ look: string; file: string | null }>` (`pipeline/hero.ts`).
- Produces: `thumbnail(dir, prompt, text, badge, variant: { name?: string; seed?: number; refs?: string[] } = {})` — `refs` chuyển thẳng vào `drawImage(..., { width: 1280, height: 720, seed, refs })`.

- [ ] **Step 1: Test hỏng**: mock `./images` (`vi.mock`) và `./ffmpeg`, gọi `thumbnail(dir, "p", "CHỮ", "FULL", { refs: ["/x/hero.jpg"] })`, kiểm `drawImage` nhận `expect.objectContaining({ refs: ["/x/hero.jpg"] })`. (Nếu import `render.ts` kéo quá nhiều thứ khó mock, tách `thumbnail` + `splitThumbText` + `thumbFontSize` sang `pipeline/thumbnail.ts`, `render.ts` re-export — giữ chữ ký.)
- [ ] **Step 2: Chạy** → FAIL. **Step 3:** thêm `refs`; `episode.ts` truyền `refs: o.heroRef ? [o.heroRef] : undefined` cho cả 3 phương án; `rethumb.ts`: thay `look = v.meta.characterLook || …` bằng `const hero = await heroRef(s, dir)` (sau khi `mkdir dir`), dùng `hero.look` trong prompt và `refs: hero.file ? [hero.file] : undefined`. **Step 4:** test + `tsc` → PASS.
- [ ] **Step 5: Commit** `feat(thumb): thumbnail tập và vẽ lại thumbnail gửi kèm ảnh mẫu nam chính`.

---

### Task 7: Đưa lên và chạy thật

- [ ] **Step 1:** `pnpm exec vitest run`, `pnpm exec tsc --noEmit`, `pnpm exec eslint .` → sạch. `git push origin main`.
- [ ] **Step 2:** `gh workflow run render.yml -R trongbao123/ma-ton-studio -f video_id=hethong:4`; đợi xong; đọc log: bible đã có mục hệ thống, danh sách chương bị trả về dàn ý (kỳ vọng các chương sau chương 18, nếu chương 18 là chương cuối có video).
- [ ] **Step 3:** Cập nhật `HANDOFF.md`: những gì đã đổi, lệnh `hethong:<id>`, cách đo kết quả (vidIQ `audience_retention` 1%/2%/5% và `thumbnail_ctr` 7 ngày đầu của 3 tập kế tiếp so với tập 1–3), việc tập #33 chờ ghép lại (`compile:4` sau khi TTS hồi lượt). Commit + push.
