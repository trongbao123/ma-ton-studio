# Kênh lịch sử — Kế hoạch 2/4: Kênh + hồ sơ tư liệu + kịch bản + soát sự thật

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Có bộ `lich-su` trong DB với 20 đề tài; một lệnh viết được kịch bản ~7.500 từ cho đề tài kế tiếp, chỉ từ hồ sơ Wikipedia (vi + en), qua lượt soát sự thật độc lập; soát không đạt thì đánh dấu "chờ sửa" + Telegram và lần sau nhảy sang đề tài kế.

**Architecture:** Thể loại mới `src/lib/story/history.ts` theo mẫu `life.ts`, rẽ nhánh ở đúng các chỗ `isLifeStory` đang rẽ trong luồng viết (`prompts.ts`, `service.ts`, `daily.ts`). Hồ sơ tư liệu `src/lib/story/dossier.ts` (Wikipedia API, en → langlinks vi) lưu ở cột mới `chapters.dossier`. Soát sự thật `src/lib/story/fact-check.ts`: AI liệt kê khẳng định không được hồ sơ ủng hộ + câu sửa → áp bản vá chuỗi → soát lại (≤ 2 vòng sửa). Bộ tạo với `autopilot=false` cho tới khi Kế hoạch 3 (dựng hình) xong — viết bằng CLI qua `render.yml`.

**Tech Stack:** TypeScript, drizzle (migration SQL tay theo mẫu `drizzle/0007_series_channel.sql`), zod (schema JSON của AI), vitest, MediaWiki Action API.

**Spec:** `docs/superpowers/specs/2026-11-21-kenh-lich-su-design.md` (mục 1, 2, 3)

## Global Constraints

- Khoá kênh `lich-su`; `youtubeTitle: "Sử Ký Kể Chuyện"`, `publishEveryDays: 3`, hashtag `#LichSu #SuKyKeChuyen #LichSuTheGioi`, playlist `"Lịch Sử Kể Chuyện"`.
- `HISTORY_GENRE = "Lịch sử"`. Không tái dùng `isLifeStory`.
- Kịch bản `HISTORY_TARGET_WORDS = 7500`, mỗi lượt `HISTORY_PART_WORDS = 2500` (3 hồi). Không áp `NARRATION_TEMPO` (việc của Kế hoạch 3).
- **Không hư cấu**: chỉ dùng chi tiết có trong hồ sơ; không thoại bịa; trích dẫn phải có nguyên văn trong hồ sơ + nói theo sách nào; sử liệu mâu thuẫn → nói cả hai; mở in medias res rồi lùi lại; kết bằng hệ quả lịch sử, không giảng đạo lý.
- **Né đề tài nhạy cảm**: chiến tranh/chính trị Việt Nam sau 1945, quan hệ Việt–Trung hiện đại, Hoàng Sa–Trường Sa, biên giới 1979, xung đột hiện đại còn tranh cãi (Trung Đông đương đại, Nga–Ukraine…). Đề tài AI tự đề xuất phải qua bộ lọc.
- Wikipedia: User-Agent chung `ma-ton-studio/1.0 (history research bot)` — không email/tên chủ kênh.
- Soát sự thật ≤ 2 vòng sửa; vẫn còn lỗi → không chuyển `draft`, lưu `chapters.fact_issues`, Telegram, ném `FactCheckFailedError`.
- Chuỗi hiển thị/prompt tiếng Việt có dấu. Gate clean-scan của devkit: không verb `handle/process/manage/perform/do/check`, ≤ 4 tham số, export có TSDoc.

## Review Focus

- Bài Wikipedia tiếng Anh không tồn tại / bị đổi hướng → dùng trang đích sau redirect; không có trang → lỗi nêu rõ tên đề tài, không viết kịch bản từ hồ sơ rỗng.
- Bài tiếng Việt không có (không có langlink vi) → hồ sơ chỉ tiếng Anh, vẫn chạy.
- AI soát trả khẳng định với `quote` không khớp nguyên văn kịch bản → bản vá bỏ qua, vòng soát sau bắt lại; không làm hỏng văn bản.
- Đề tài AI tự đề xuất chứa năm ≥ 1945 hoặc từ khoá nhạy cảm → bị loại trước khi lưu.
- Chương "chờ sửa" (có `fact_issues`) không được chọn viết lại ở lượt sau; đề tài kế được viết.

---

### Task 1: Cột DB + hồ sơ kênh

**Files:**
- Create: `drizzle/0008_history_dossier.sql`
- Modify: `drizzle/meta/_journal.json` (thêm entry idx 8, theo mẫu entry 7)
- Modify: `src/db/schema.ts` (bảng `chapters`)
- Modify: `src/lib/channel-profile.ts`
- Test: `src/lib/channel-profile.test.ts` (tạo mới nếu chưa có)

**Interfaces:**
- Produces: `chapters.dossier: jsonb("dossier").$type<Dossier | null>()`, `chapters.factIssues: jsonb("fact_issues").$type<FactIssue[] | null>()` (kiểu `Dossier`, `FactIssue` khai báo ở Task 3/4 — tạm khai báo ở `src/lib/story/history-types.ts` để schema import được); `channelProfile("lich-su")`.

- [ ] **Step 1: Test** — `channelProfile("lich-su")` có `youtubeTitle "Sử Ký Kể Chuyện"`, `publishEveryDays 3`, `hashtags` chứa `"#LichSu"`, `playlistLabel "Lịch Sử Kể Chuyện"`; `titleMatches("lich-su", "sử ký kể chuyện")` → true.
- [ ] **Step 2: Chạy** `pnpm exec vitest run src/lib/channel-profile.test.ts` → FAIL.
- [ ] **Step 3:** Thêm hồ sơ vào `PROFILES`; tạo `history-types.ts` với `type DossierSource = { lang: "vi" | "en"; title: string; url: string; text: string }`, `type Dossier = { topic: string; sources: DossierSource[]; fetchedAt: string }`, `type FactIssue = { quote: string; verdict: "khong-co" | "mau-thuan"; note: string; fix: string }`; thêm 2 cột vào `chapters`; SQL: `ALTER TABLE "chapters" ADD COLUMN "dossier" jsonb;` + `ALTER TABLE "chapters" ADD COLUMN "fact_issues" jsonb;`.
- [ ] **Step 4: Chạy** test → PASS; `pnpm typecheck` → sạch.
- [ ] **Step 5: Commit** `feat(lich-su): hồ sơ kênh + cột dossier/fact_issues`.

### Task 2: Thể loại lịch sử (đề tài, prompt, bộ lọc nhạy cảm)

**Files:**
- Create: `src/lib/story/history.ts`, `src/lib/story/history.test.ts`

**Interfaces:**
- Produces:
  - `HISTORY_GENRE = "Lịch sử"`, `isHistoryStory(s: Pick<Series,"genre"> | null | undefined): boolean`
  - `HISTORY_TARGET_WORDS = 7500`, `HISTORY_PART_WORDS = 2500`
  - `type HistoryTopic = { title: string; wiki: string; angle: string }` — `wiki` = tiêu đề bài Wikipedia tiếng Anh
  - `HISTORY_PILOT: HistoryTopic[]` — 20 đề tài, đúng thứ tự (wiki): `Battle of Bạch Đằng (938)`, `Fall of Constantinople`, `Battle of Bạch Đằng (1288)`, `Battle of Waterloo`, `Trưng sisters`, `Battle of Thermopylae`, `Battle of Ngọc Hồi-Đống Đa`, `Battle of Tsushima`, `Battle of Như Nguyệt River`, `Siege of Port Arthur`, `Lam Sơn uprising`, `Battle of Red Cliffs`, `Sinking of the Titanic`, `Hannibal's crossing of the Alps`, `Assassination of Julius Caesar`, `French invasion of Russia`, `Battle of Hastings`, `Qin's wars of unification`, `Battle of Gaugamela`, `Genghis Khan`. `title` = tiêu đề tiếng Việt kể chuyện, `angle` = 1–2 câu khoảnh khắc mở đầu + câu hỏi trung tâm.
  - `topicOutline(t: HistoryTopic): string` → chứa dòng `Wikipedia: <wiki>`; `wikiTitleOf(outline: string): string | null`
  - `isSensitiveTopic(text: string): boolean` — true nếu có năm 4 chữ số ≥ 1945, hoặc từ khoá (không phân biệt hoa thường, có/không dấu): `hoàng sa, trường sa, biển đông, biên giới 1979, chiến tranh việt nam, kháng chiến chống mỹ, việt nam cộng hòa, 1975, israel, palestine, gaza, ukraine, đài loan, tây tạng, tân cương`
  - `historyWriterSystem(): string`; `historyChapterPrompt(s: Series, chapter: Chapter, dossierText: string): { system; prompt }`; `historyContinueTask(written: number, target?: number): string`; `historyIsFinalPart(written: number, target?: number): boolean` (giống `lifeIsFinalPart` với `HISTORY_PART_WORDS`); `historyOutlinePrompt(s: Series, previous: Pick<Chapter,"number"|"title">[], count: number): { system; prompt }` (yêu cầu mỗi đề tài có `Wikipedia: <tiêu đề tiếng Anh>` trong outline, liệt kê danh sách cấm)
  - `HISTORY_BIBLE`, `HISTORY_STYLE`, `HISTORY_PREMISE` (chuỗi)

- [ ] **Step 1: Test**:
  - `HISTORY_PILOT.length === 20`; mọi `isSensitiveTopic(topicOutline(t) + t.title) === false`; `wikiTitleOf(topicOutline(HISTORY_PILOT[0])) === "Battle of Bạch Đằng (938)"`; `wikiTitleOf("không có") === null`.
  - `isSensitiveTopic("Trận Điện Biên Phủ 1954")`, `("Hải chiến Hoàng Sa")`, `("Chiến tranh biên giới 1979")`, `("xung dot Gaza")` → true; `("Trận Bạch Đằng 1288")`, `("Đắm tàu Titanic 1912")` → false.
  - `historyChapterPrompt(...)`: `prompt` chứa nguyên `dossierText` truyền vào, chứa "không hư cấu"/"chỉ dùng" (luật) và `HISTORY_PART_WORDS`; `system` không chứa "HOÀN TOÀN HƯ CẤU".
  - `historyIsFinalPart(5000) === true`, `historyIsFinalPart(2500) === false`.
- [ ] **Step 2: Chạy** `pnpm exec vitest run src/lib/story/history.test.ts` → FAIL.
- [ ] **Step 3: Cài đặt.** Prompt viết gồm: luật không hư cấu (Global Constraints); 3 hồi (HỒI 1 mở in medias res khoảnh khắc căng nhất + lùi về bối cảnh; HỒI 2 diễn biến chính theo trình tự, mỗi ~1.200 từ một mốc mới, thẻ năm/tháng nói rõ khi nhảy thời gian; HỒI 3 cao trào + kết cục + hệ quả lịch sử); kể ngôi thứ ba người dẫn chuyện, câu ngắn cho tai nghe, số năm đọc được; khi nhắc nguồn mâu thuẫn dùng "sử chép rằng…", "có ý kiến cho rằng…"; KHÔNG markdown/tiêu đề phụ. Hồ sơ đặt trong khối `<ho_so>…</ho_so>`.
- [ ] **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(lich-su): thể loại lịch sử — 20 đề tài, prompt không hư cấu, lọc đề tài nhạy cảm`.

### Task 3: Hồ sơ tư liệu Wikipedia

**Files:**
- Create: `src/lib/story/dossier.ts`, `src/lib/story/dossier.test.ts`

**Interfaces:**
- Consumes: `Dossier`, `DossierSource` (Task 1)
- Produces:
  - `DOSSIER_MAX_CHARS_PER_SOURCE = 40_000`
  - `buildDossier(wikiTitle: string): Promise<Dossier>` — 1) `GET https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=extracts|langlinks|info&explaintext=1&inprop=url&lllang=vi&titles=<wiki>`; trang `missing` → `Error("Không tìm thấy bài Wikipedia \"<wiki>\"")`; 2) có langlink vi → cùng truy vấn trên `vi.wikipedia.org` với tiêu đề vi (không cần langlinks); 3) mỗi nguồn cắt `text` ở `DOSSIER_MAX_CHARS_PER_SOURCE` (cắt ở ranh giới đoạn `\n\n` gần nhất trước giới hạn); bỏ các mục cuối `== References ==`, `== Tham khảo ==`, `== External links ==`, `== Liên kết ngoài ==`, `== Chú thích ==`, `== See also ==`, `== Xem thêm ==` trở đi. Header `User-Agent` theo Global Constraints. Nguồn vi đứng trước en.
  - `dossierText(d: Dossier): string` — mỗi nguồn: `### <lang> — <title> (<url>)\n<text>`

- [ ] **Step 1: Test** (mock `fetch` theo URL host):
  - en có extract + langlink vi "Trận Bạch Đằng (938)" + fullurl; vi có extract → `sources.map(s=>s.lang)` = `["vi","en"]`, `url` lấy từ `fullurl`; lời gọi en có `redirects=1` và header `User-Agent` chứa `ma-ton-studio`.
  - Trang en `missing` → reject `/Không tìm thấy bài Wikipedia/`, chỉ 1 lời gọi.
  - Không có langlinks → chỉ `["en"]`.
  - Extract có `== References ==\nabc` → `text` không chứa `abc`; extract 50.000 ký tự gồm nhiều đoạn → `text.length <= 40000` và kết thúc ở cuối một đoạn.
  - `dossierText` chứa `### vi — Trận Bạch Đằng (938) (`.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Cài đặt.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(lich-su): hồ sơ tư liệu Wikipedia (en + vi qua langlink)`.

### Task 4: Soát sự thật

**Files:**
- Create: `src/lib/story/fact-check.ts`, `src/lib/story/fact-check.test.ts`

**Interfaces:**
- Consumes: `FactIssue` (Task 1), `TextProvider` (`src/lib/ai/types.ts`)
- Produces:
  - `FACT_FIX_ROUNDS = 2`
  - `factIssuesSchema` (zod): `{ issues: { quote: string; verdict: "khong-co" | "mau-thuan"; note: string; fix: string }[] }`
  - `factCheckPrompt(script: string, dossierText: string): { system; prompt }` — yêu cầu: duyệt MỌI câu có năm/ngày, tên người, địa danh, con số, câu trích dẫn, quan hệ nhân quả; CHỈ trả các câu KHÔNG được hồ sơ ủng hộ hoặc mâu thuẫn; `quote` copy NGUYÊN VĂN một đoạn ngắn liên tục từ kịch bản; `fix` = câu thay thế đúng theo hồ sơ (giữ giọng kể) hoặc `""` để xoá; câu chung chung không kiểm chứng được nhưng không sai (miêu tả không khí) thì bỏ qua.
  - `applyFactFixes(script: string, issues: FactIssue[]): string` — thay lần xuất hiện đầu của `quote` bằng `fix` (fix rỗng → xoá, gộp khoảng trắng thừa); `quote` không có trong script → bỏ qua.
  - `factCheckScript(ai: TextProvider, script: string, dossierText: string): Promise<{ script: string; issues: FactIssue[] }>` — soát → còn lỗi thì vá → soát lại, tối đa `FACT_FIX_ROUNDS` vòng vá; trả kịch bản cuối + lỗi còn lại (rỗng = đạt). Gọi `generateJson({ ...factCheckPrompt, schema, temperature: 0, task: "story", maxOutputTokens: 8000 })`.
  - `class FactCheckFailedError extends Error { issues: FactIssue[] }`

- [ ] **Step 1: Test** (AI giả: object có `generateJson` trả lần lượt các kết quả định sẵn):
  - `applyFactFixes("Năm 939 Ngô Quyền thắng. Trời mưa.", [{quote:"Năm 939",fix:"Năm 938",…}])` → `"Năm 938 Ngô Quyền thắng. Trời mưa."`; fix `""` cho `" Trời mưa."` → không còn "Trời mưa", không có 2 khoảng trắng liền; quote không khớp → chuỗi giữ nguyên.
  - `factCheckScript`: lần 1 trả 1 lỗi, lần 2 trả `[]` → `issues` rỗng, `script` đã vá, `generateJson` gọi 2 lần.
  - Lỗi mãi → gọi đúng `1 + FACT_FIX_ROUNDS` = 3 lần, `issues` = lỗi của lần cuối.
  - `factCheckPrompt` chứa nguyên kịch bản và hồ sơ.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Cài đặt.** **Step 4: Chạy** → PASS.
- [ ] **Step 5: Commit** `feat(lich-su): soát sự thật kịch bản theo hồ sơ (≤2 vòng sửa)`.

### Task 5: Nối vào luồng viết + tạo bộ + CLI

**Files:**
- Modify: `src/lib/story/prompts.ts` (`chapterPrompt`, `outlinePrompt`, `maxContinues`)
- Modify: `src/lib/story/service.ts` (`writeChapterStep`, `planChapters`)
- Modify: `pipeline/daily.ts` (`writeNext`, `dispatchCompilations`)
- Modify: `pipeline/new-series.ts` (thêm `newHistorySeries`), `pipeline/render.ts` (CLI ~dòng 1401)
- Create: `pipeline/history-script.ts`
- Test: `src/lib/story/history.test.ts` (thêm), `pipeline/history-script.test.ts`

**Interfaces:**
- Consumes: Task 2–4
- Produces:
  - `pickChapterToWrite<T extends { status: string; factIssues: unknown }>(list: T[]): T | undefined` (trong `history.ts`) — chương `outline` đầu tiên có `factIssues == null`
  - `writeChapterStep` với bộ lịch sử: `start` → nếu `chapter.dossier` null thì `buildDossier(wikiTitleOf(outline))` (null → `Error("Đề tài thiếu dòng Wikipedia:")`) và lưu; prompt `historyChapterPrompt(s, chapter, dossierText(dossier))`. `continue` → `{ ...base, prompt: base.prompt + "\n\nPHẦN ĐÃ VIẾT:\n" + content + "\n\n" + historyContinueTask(words) }` (theo cách `continuePrompt` ghép cho chuyện đời). `enough` như chuyện đời nhưng dùng `historyIsFinalPart`. Không chạy biên tập mở đầu (`polishOpening`). `finish` → `factCheckScript`; còn lỗi → lưu `content` đã vá + `factIssues`, giữ `status "outline"`, `notify` (đề tài + 5 lỗi đầu: quote → note), ném `FactCheckFailedError`; đạt → lưu content đã vá, `factIssues null`, rồi tóm tắt + `draft` như cũ.
  - `planChapters` bộ lịch sử: bỏ đề tài `isSensitiveTopic(title + outline)` hoặc `wikiTitleOf(outline) == null` trước khi insert (log số đề tài bị loại).
  - `writeNext` dùng `pickChapterToWrite`; đếm "còn ≥ 2 outline" chỉ tính chương không có `factIssues`.
  - `newHistorySeries(channel = "lich-su")` — giống `newLifeSeries`: kiểm khoá, bỏ qua nếu đã có bộ `HISTORY_GENRE` trên kênh; insert `title "Sử Ký Kể Chuyện"`, `genre HISTORY_GENRE`, `premise/bible/style` từ Task 2, `channel`, `targetWords HISTORY_TARGET_WORDS`, **`autopilot: false`**, `autoApprove: true`, `chaptersPerDay: 1`, `episodeChapters: 0`, `makeShort: false`, `autoPublish: true`; nạp `HISTORY_PILOT` với `outline = topicOutline(t)`; Telegram.
  - `writeHistoryScript(seriesId: number): Promise<{ chapterId: number; words: number } | null>` (`pipeline/history-script.ts`) — chọn `pickChapterToWrite`, gọi `writeChapterStep` start → continue (tới `enough`, tối đa `maxContinues`) → finish; `FactCheckFailedError` → log + trả null (đã notify).
  - CLI trong `render.ts`: `newhistory[:<kênh>]` → `newHistorySeries`; `historyscript:<seriesId>` → `writeHistoryScript`.

- [ ] **Step 1: Test** `pickChapterToWrite([{status:"draft",factIssues:null},{status:"outline",factIssues:[{}]},{status:"outline",factIssues:null,id:3}])` → phần tử id 3; danh sách toàn `factIssues` → `undefined`.
- [ ] **Step 2: Chạy** → FAIL. **Step 3: Cài đặt** các thay đổi trong Interfaces. **Step 4:** `pnpm exec vitest run && pnpm typecheck && pnpm lint` → chỉ fail có sẵn `music-life.test.ts`.
- [ ] **Step 5: Commit** `feat(lich-su): nối thể loại lịch sử vào luồng viết + CLI newhistory/historyscript`.

### Task 6: Chạy thật một kịch bản

Không code mới. Sau khi merge (cần chủ kênh đồng ý push `main` — migration chạy ở build Vercel):

- [ ] **Step 1:** `gh workflow run render.yml -f video_id=newhistory:lich-su` → log có `✔ #<id> Sử Ký Kể Chuyện`.
- [ ] **Step 2:** `gh workflow run render.yml -f video_id=historyscript:<id>` → log có số từ và kết quả soát.
- [ ] **Step 3:** Đọc kịch bản trên web `/chapters/<id>`: tự kiểm 10 mốc năm/tên ngẫu nhiên với Wikipedia; mở đầu là khoảnh khắc căng; không thoại bịa. Ghi kết quả vào `HANDOFF.md`, gửi chủ kênh link đọc.
