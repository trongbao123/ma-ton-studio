# Kênh lịch sử — Kế hoạch 2b: Hồ sơ tư liệu 3 lớp

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildDossier(wikiTitle)` gom: Wikipedia bài chính (vi+en) + ≤5 bài liên quan; đoạn sử liệu gốc trên Wikisource; ≤5 trang web tin cậy qua Tavily (nếu có key) — mỗi nguồn có loại, tiêu đề, URL.

**Architecture:** Tách `src/lib/story/dossier.ts` thành bộ điều phối + 3 module nguồn (`dossier-wikipedia.ts`, `dossier-wikisource.ts`, `dossier-web.ts`) và helper gọi MediaWiki có thử lại 429 (`wiki-api.ts`). Mỗi module trả `DossierSource[]`, lỗi của lớp phụ (liên quan / Wikisource / web) chỉ log, không làm hỏng hồ sơ; lớp chính (bài Wikipedia en) lỗi thì ném như cũ.

**Tech Stack:** TypeScript, MediaWiki Action API (`query/extracts`, `parse/links`, `parse/text`, `list=search`), Tavily Search API, vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-kenh-lich-su-design.md` mục 2.

## Global Constraints

- `DossierSource = { kind: "wikipedia" | "wikisource" | "web"; lang: "vi" | "en"; title: string; url: string; text: string }`.
- Trần ký tự: bài chính 40.000/bài; bài liên quan 8.000/bài, tối đa 5; Wikisource 6.000/trang, tối đa 3 trang; web 8.000/trang, tối đa 5. `DOSSIER_MIN_CHARS = 3_000` (tổng) giữ nguyên.
- User-Agent `ma-ton-studio/1.0 (history research bot)` cho mọi gọi Wikimedia; thử lại 429 như hiện có.
- Wikisource vi chỉ nhận trang có tiêu đề bắt đầu bằng: `Đại Việt sử ký toàn thư`, `Khâm định Việt sử Thông giám cương mục`, `Đại Nam thực lục`, `Việt sử lược`, `An Nam chí lược`, `Đại Việt sử lược`. en.wikisource nhận mọi kết quả trong không gian chính trừ trang có `(disambiguation)`.
- Web: chỉ tên miền `britannica.com, worldhistory.org, history.com, nationalgeographic.com, smithsonianmag.com, livius.org, bbc.co.uk, bbc.com, baotanglichsu.vn, vnexpress.net, tuoitre.vn, thanhnien.vn, nghiencuulichsu.com`. Không có `TAVILY_API_KEY` → bỏ lớp web, không lỗi. Key thêm vào `SECRET_KEYS` (group `service`).
- Thứ tự trong hồ sơ: wikipedia chính (vi, en) → wikisource → web → wikipedia liên quan.

## Review Focus

- Bài liên quan là trang rộng (Vietnam, China…) hoặc rác (`ISBN (identifier)`, `Year 938`, `938`, `Geographic coordinate system`) → bị loại.
- Wikisource trả tiểu thuyết (`Nam cực tinh huy/Hồi 14`) → bị loại theo danh sách bộ sử.
- Trang Wikisource dài mà từ khoá ở giữa → lấy đoạn quanh từ khoá, không chỉ đầu trang.
- Tavily trả trang ngoài danh sách tên miền (dù đã lọc ở request) → bị loại lần nữa phía mình.
- Một lớp phụ lỗi mạng/429 hết lượt → hồ sơ vẫn trả các lớp còn lại.

---

### Task 1: Tách helper MediaWiki + kiểu nguồn có `kind`

**Files:** Create `src/lib/story/wiki-api.ts`; Modify `src/lib/story/history-types.ts`, `src/lib/story/dossier.ts`, `src/lib/story/dossier.test.ts`

**Interfaces — Produces:**
- `type Sleep = (ms: number) => Promise<void>`; `realSleep`
- `wikiApi<T>(host: string, params: Record<string, string>, sleep?: Sleep): Promise<T>` — GET `https://<host>/w/api.php?format=json&formatversion=2&…`, User-Agent, thử lại 429 (Retry-After / 5s×lần), `!ok` → `Error("<host> lỗi <status>")`.
- `htmlToText(html: string): string` — bỏ `<script>/<style>`, `<br>`/`</p>`/`</div>`/`</li>` → xuống dòng, bỏ thẻ, giải mã entity (`&amp; &lt; &gt; &quot; &#39; &nbsp; &#NNN;`), gộp dòng trống.
- `DossierSource.kind` bắt buộc; hiện có gắn `"wikipedia"`.

- [ ] Test `htmlToText('<p>A &amp; B</p><script>x</script><br>C&#272;')` → `"A & B\nCĐ"`; các test dossier cũ cập nhật `kind: "wikipedia"`; test 429 giữ nguyên (đi qua `wikiApi`).
- [ ] Chạy `pnpm exec vitest run src/lib/story` → FAIL; cài đặt; → PASS; commit `refactor(lich-su): helper MediaWiki dùng chung + kind cho nguồn hồ sơ`.

### Task 2: Wikipedia bài liên quan

**Files:** Create `src/lib/story/dossier-wikipedia.ts`, `src/lib/story/dossier-wikipedia.test.ts`; Modify `dossier.ts` (chuyển phần Wikipedia chính sang đây)

**Interfaces — Produces:**
- `RELATED_MAX = 5`, `RELATED_MAX_CHARS = 8_000`
- `pickRelatedTitles(leadLinks: string[], articleText: string): string[]` — bỏ: chứa `(identifier)`, `(disambiguation)`, `coordinate`, `Killed in action`, chỉ là số/`Year N`, trùng tiêu đề chính, và danh sách rộng `BROAD_TITLES` (Vietnam, China, France, Japan, Russia, England, United Kingdom, Greece, Italy, Spain, Germany, Mongolia, Korea, India, Persia, Europe, Asia, Roman Empire, Byzantine Empire, Ottoman Empire); xếp theo số lần tiêu đề xuất hiện trong `articleText` (không phân biệt hoa thường) giảm dần; lấy `RELATED_MAX`.
- `wikipediaSources(wikiTitle: string, sleep?: Sleep): Promise<{ main: DossierSource[]; related: DossierSource[] }>` — bài chính như cũ; liên kết lấy bằng `action=parse&page=<en title>&section=0&prop=links` (ns 0); bài liên quan lấy extract en, cắt `RELATED_MAX_CHARS`; lỗi lớp liên quan → `related: []` + `console.warn`.

- [ ] Test `pickRelatedTitles(["Geographic coordinate system","938","Year 938","ISBN (identifier)","Vietnam","Ngô Quyền","Southern Han","Liu Hongcao","Kiều Công Hãn"], "Ngô Quyền … Ngô Quyền … Southern Han … Liu Hongcao")` → bắt đầu bằng `["Ngô Quyền", …]`, không chứa rác/Vietnam, độ dài ≤ 5.
- [ ] Test `wikipediaSources` (fetch giả theo URL): có `related` với `kind "wikipedia"`, `text.length ≤ 8000`; parse links lỗi 500 → `related` rỗng, `main` vẫn đủ.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): hồ sơ thêm tối đa 5 bài Wikipedia liên quan`.

### Task 3: Sử liệu gốc Wikisource

**Files:** Create `src/lib/story/dossier-wikisource.ts`, `.test.ts`

**Interfaces — Produces:**
- `VI_CHRONICLES` (danh sách tiền tố Global Constraints); `WIKISOURCE_MAX_PAGES = 3`, `WIKISOURCE_MAX_CHARS = 6_000`
- `excerptAround(text: string, keywords: string[], maxChars: number): string` — lấy các cửa sổ ±1.500 ký tự quanh lần xuất hiện của từ khoá (không phân biệt hoa thường), gộp cửa sổ chồng nhau, nối bằng `\n…\n`, cắt `maxChars`; không có từ khoá → `""`.
- `wikisourceSources(query: { lang: "vi" | "en"; search: string; keywords: string[] }, sleep?: Sleep): Promise<DossierSource[]>` — `list=search&srsearch=<search>&srnamespace=0&srlimit=10`; vi chỉ nhận tiêu đề có tiền tố `VI_CHRONICLES`; en bỏ `(disambiguation)`; mỗi trang `action=parse&prop=text` → `htmlToText` → `excerptAround`; bỏ trang excerpt rỗng; tối đa `WIKISOURCE_MAX_PAGES`; lỗi → `[]` + warn. URL: `https://<lang>.wikisource.org/wiki/<title>`.
- Gọi từ điều phối: vi với `search` = tiêu đề bài Wikipedia vi (bỏ phần trong ngoặc) + tên nhân vật đầu trong `related`, `keywords` = các từ ≥ 2 âm tiết của tiêu đề vi bỏ ngoặc (vd "Bạch Đằng") và tên năm trong ngoặc nếu có; en với tiêu đề en.

- [ ] Test `excerptAround("a…(3000 ký tự)…Bạch Đằng…(3000)…", ["bạch đằng"], 6000)` chứa "Bạch Đằng", độ dài < 3.200; không có từ khoá → `""`.
- [ ] Test `wikisourceSources({lang:"vi",…})` với kết quả tìm `["Nam cực tinh huy/Hồi 14","Đại Việt sử ký toàn thư/Tập II/Cuốn thứ năm/Ngô sứ quân"]` → chỉ 1 nguồn, `kind "wikisource"`, title là trang Toàn thư.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): hồ sơ thêm đoạn sử liệu gốc từ Wikisource`.

### Task 4: Web tin cậy qua Tavily

**Files:** Create `src/lib/story/dossier-web.ts`, `.test.ts`; Modify `src/lib/secret-keys.ts`

**Interfaces — Produces:**
- `TRUSTED_DOMAINS` (Global Constraints); `WEB_MAX_PAGES = 5`; `WEB_MAX_CHARS = 8_000`
- `isTrustedUrl(url: string): boolean` — hostname bằng hoặc kết thúc bằng `.<domain>`.
- `webSources(query: string): Promise<DossierSource[]>` — không có `process.env.TAVILY_API_KEY` → `[]`. `POST https://api.tavily.com/search` header `Authorization: Bearer <key>`, body `{ query, search_depth: "advanced", include_domains: TRUSTED_DOMAINS, include_raw_content: true, max_results: 8 }`; lọc `isTrustedUrl`; `text = (raw_content || content)` cắt `WEB_MAX_CHARS`; `lang` = `"vi"` nếu tên miền `.vn` hoặc thuộc báo VN, còn lại `"en"`; bỏ trang text < 500 ký tự; tối đa `WEB_MAX_PAGES`; lỗi → `[]` + warn.
- `SECRET_KEYS` thêm `{ env: "TAVILY_API_KEY", label: "Tavily (tìm tư liệu web)", group: "service", help: "app.tavily.com → API Keys · free 1.000 lượt/tháng" }`.

- [ ] Test: không key → `[]`, `fetch` không gọi; có key → body có `include_domains`, header Bearer; kết quả có 1 URL `evil.com` bị loại; `raw_content` dài 20.000 → `text.length ≤ 8000`.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): hồ sơ thêm trang web tin cậy qua Tavily (tuỳ chọn)`.

### Task 5: Điều phối + prompt nói rõ thứ bậc nguồn

**Files:** Modify `src/lib/story/dossier.ts`, `dossier.test.ts`, `src/lib/story/history.ts` (luật nguồn)

**Interfaces — Produces:** `buildDossier(wikiTitle, sleep?)` = main → wikisource (vi nếu có bài vi, + en) → web (`query` = tiêu đề en) → related; ngưỡng tối thiểu tính trên tổng; `dossierText` header `### <kind> · <lang> — <title> (<url>)`.
- `NO_FICTION_RULES` thêm: "Nguồn mâu thuẫn: ưu tiên sử liệu gốc (wikisource) và bách khoa (Britannica, Wikipedia) hơn báo; nói rõ chỗ khác nhau."

- [ ] Test điều phối (mock 4 module bằng `vi.mock`): thứ tự `kind` = `wikipedia,wikipedia,wikisource,web,wikipedia`; web ném lỗi → vẫn trả các lớp khác.
- [ ] Toàn bộ `pnpm exec vitest run && pnpm typecheck && pnpm lint`.
- [ ] Chạy thật (máy local, không cần key): `Battle of Bạch Đằng (938)` và `Battle of Ngọc Hồi-Đống Đa` → in tổng ký tự từng lớp; Bạch Đằng 938 phải > 30.000.
- [ ] Commit `feat(lich-su): điều phối hồ sơ 3 lớp + luật thứ bậc nguồn`.
