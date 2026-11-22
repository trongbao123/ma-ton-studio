# Kênh lịch sử — Kế hoạch 3/5: Dựng hình + âm thanh (Claude đạo diễn)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Từ kịch bản + hồ sơ tư liệu, dựng ra video 45 phút đúng phong cách chủ kênh duyệt: Claude đạo diễn từng cảnh (bản đồ phẳng đậm có lính chibi, thẻ chữ, tranh khắc giấy cũ, địa hình 3D), giọng History US, nhạc sử thi + trống + tiếng hô, phụ đề phát sáng; QC chặn video sai trước khi đăng.

**Architecture:** Một lượt AI (`storyboard`) biến kịch bản thành **danh sách cảnh** (JSON có schema) — mỗi cảnh ghi loại, nội dung, máy quay, âm thanh, chữ. Mỗi loại cảnh là một **renderer** riêng (`scene-map.ts`, `scene-card.ts`, `scene-art.ts`, `scene-terrain.ts`) trả về file mp4 cùng độ dài; `history-render.ts` ghép theo mốc giọng đọc, trộn tiếng, đốt phụ đề. Địa hình 3D render qua Kaggle (tái dùng `pipeline/kaggle.ts`), hết giờ thì cảnh đó tự lùi về bản đồ 2D.

**Tech Stack:** TypeScript, ffmpeg, `@resvg/resvg-js` (SVG→PNG), Natural Earth + OpenStreetMap Nominatim + Terrarium tiles, Blender (trên Kaggle), ivoi TTS, vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-kenh-lich-su-design.md` (mục 4–6c, 7, 10)

Bản dựng thử đã chạy được (tham khảo, KHÔNG phải code production): `pipeline/history-preview.ts` (thẻ năm, mực loang, phụ đề glow, trống), `.render/map-spike/map-spike.mts` (bản đồ phẳng + lính giấy), `.render/geo3d/{prep.mts,scene.py}` (địa hình 3D Blender).

## Global Constraints

- Giọng: `HISTORY_IVOI_VOICE = "en_male_history_1"`, `HISTORY_TEMPO = 1` (đã có trong `src/lib/story/history.ts`).
- Khung hình 1920×1080, 25 fps. Cảnh **3–6 giây**, cắt tại khoảng lặng giọng gần nhất.
- Máy quay trong một cảnh: đứng yên, đẩy ≤10%, hoặc lia mượt. **Cấm zoom giật**; đổi vùng thì cắt sang cảnh mới.
- Chữ, nhãn địa danh, nhân vật **không đè nhau**.
- Tông: bản đồ phẳng màu **trầm** (không rực như Thanh Pahm), giấy cũ sepia cho bối cảnh/mở/kết. KHÔNG châm biếm nhân vật lịch sử, KHÔNG avatar người dẫn, KHÔNG ảnh chụp hiện vật bảo tàng/tượng đài/ảnh hiện đại.
- Ảnh tư liệu: chỉ Commons giấy phép PD/CC0/CC BY/CC BY-SA, kèm ghi công; ảnh AI vẽ có nhãn **"Minh họa"** góc trên.
- Âm: nhạc sử thi đổi theo đoạn, trống trận + tiếng hô ở cảnh giao chiến (tiếng gào không lời; câu hô có chữ chỉ khi có nguyên văn trong hồ sơ).
- Tư liệu địa lý: Natural Earth (PD), Nominatim (≤1 lượt/giây, User-Agent `ma-ton-studio/1.0 (history research bot)`), Terrarium tiles.
- Job Actions ≤ 355 phút; video 45 phút phải dựng xong trong một job (không kể phần 3D chạy Kaggle).
- Gate devkit: không verb `handle/process/manage/check`, ≤4 tham số (gộp typed object), export có TSDoc, không ternary lồng.

## Review Focus

- Kịch bản có câu dài hơn 6 giây không tìm được khoảng lặng → cảnh vẫn ≤6 giây, cắt ở ranh giới từ, không tràn.
- AI đạo diễn trả cảnh có địa danh không tra được toạ độ → cảnh đó lùi về thẻ chữ, không làm hỏng cả video.
- Kaggle hết giờ/timeout giữa chừng → cảnh 3D lùi về bản đồ 2D, video vẫn đủ độ dài.
- Commons không có ảnh nào hợp đề tài → cảnh `art` chuyển sang AI vẽ (có nhãn "Minh họa"), không để khung trống.
- Tổng độ dài các cảnh lệch so với giọng đọc (AI trả thiếu/thừa) → tự co giãn cảnh cuối, video khớp đúng độ dài giọng.

---

### Task 1: Kịch bản phân cảnh (Claude đạo diễn)

**Files:** Create `src/lib/story/storyboard.ts`, `storyboard.test.ts`

**Interfaces — Produces:**
- `type SceneKind = "map" | "terrain" | "card" | "art"`
- `type DirectedScene = { kind: SceneKind; from: number; to: number; title?: string; subtitle?: string; places?: string[]; route?: string[]; battles?: string[]; artQuery?: string; artPrompt?: string; camera: "hold" | "push" | "pan"; sfx: ("drum" | "shout" | "horn" | "fire" | "water")[]; }` — `from`/`to` là chỉ số câu trong kịch bản.
- `storyboardSchema` (zod) khớp `DirectedScene[]`.
- `storyboardPrompt(script: string, dossierText: string): PromptPair` — luật: mỗi cảnh 1–3 câu liền nhau, phủ kín kịch bản không chồng lấn; `map` cho hành quân/vây hãm, `terrain` cho 2–4 cảnh đắt giá nhất, `card` cho mốc thời gian/con số/trích dẫn, `art` cho chân dung/bối cảnh; địa danh ghi **tên tiếng Việt kèm tỉnh/nước** để tra toạ độ; `sfx` chỉ ở cảnh có đánh nhau; cấm châm biếm.
- `directScript(ai: TextProvider, script: string, dossierText: string): Promise<DirectedScene[]>` — gọi `generateJson`, `task: "scenes"`, `temperature: 0.4`.
- `scenesToShots(scenes: DirectedScene[], cues: Cue[], seconds: number): Shot[]` với `type Shot = DirectedScene & { start: number; end: number }` — đổi chỉ số câu thành giây theo `cues`; cảnh > `SCENE_MAX_SECONDS` (6) bị **chia đôi** tại khoảng lặng gần giữa nhất; cảnh < `SCENE_MIN_SECONDS` (3) gộp với cảnh kề cùng `kind`; cảnh cuối co giãn cho `end === seconds`.

- [ ] Test `scenesToShots`: cảnh 9 giây → 2 shot ≤6 giây; cảnh 1,5 giây cạnh cảnh cùng loại → gộp; tổng `end` cuối == `seconds`; không chồng lấn, không hở.
- [ ] Test `storyboardPrompt` chứa nguyên kịch bản + hồ sơ + chữ "không châm biếm" và tên 4 loại cảnh.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): Claude đạo diễn phân cảnh kịch bản`.

### Task 2: Toạ độ địa danh (có cache, có giới hạn tốc độ)

**Files:** Create `src/lib/story/geocode.ts`, `geocode.test.ts`; Modify `src/db/schema.ts` (+ migration `drizzle/0009_places.sql` + snapshot) — bảng `places(query text primary key, lat double precision, lon double precision, updated_at timestamp)`.

**Interfaces — Produces:**
- `geocodePlace(query: string, sleep?: Sleep): Promise<{ lat: number; lon: number } | null>` — đọc DB trước; chưa có thì gọi Nominatim (`format=json&limit=1`), chờ `NOMINATIM_GAP_MS = 1100` giữa 2 lượt, lưu DB; không tìm thấy → `null` (vẫn lưu để khỏi hỏi lại, dùng cột `lat` NULL).
- `geocodeAll(queries: string[], sleep?: Sleep): Promise<Map<string, { lat: number; lon: number }>>` — bỏ qua query không tra được.
- `inBounds(p: { lat: number; lon: number }, box: { w: number; e: number; s: number; n: number }): boolean`.

- [ ] Test: gọi 2 lần cùng query → `fetch` chỉ 1 lần (lần 2 lấy từ DB giả); Nominatim trả `[]` → `null` và không ném; 3 query → `sleep` được gọi 2 lần với ≥1100.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): tra toạ độ địa danh (cache DB, giới hạn tốc độ)`.

### Task 3: Cảnh bản đồ phẳng + lính chibi

**Files:** Create `pipeline/scene-map.ts`, `scene-map.test.ts`; Create `pipeline/geo-base.ts` (dùng chung với Task 5)

**Interfaces — Produces (geo-base.ts):**
- `type GeoBox = { w: number; e: number; s: number; n: number }`
- `boxFor(points: { lat: number; lon: number }[], aspect: number): GeoBox` — khung ôm hết điểm + đệm 25%, đúng tỉ lệ 16:9 sau khi nhân `cos(vĩ độ)`.
- `GEO_FILES = ["ne_10m_land", "ne_10m_coastline", "ne_10m_rivers_lake_centerlines"]`; `ensureGeoData(dir?: string): Promise<string>` — tải từ `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/<tên>.geojson` vào `.render/geo` (15 MB, PD — KHÔNG commit vào repo; cache `.render` của Actions giữ lại giữa các lần chạy), đã có thì bỏ qua.
- `loadShapes(box: GeoBox): Promise<{ land: number[][][]; rivers: number[][][]; coast: number[][][] }>` — đọc file đã tải, lọc theo `box`.
- `projector(box: GeoBox, w: number, h: number): (lon: number, lat: number) => [number, number]`

**Produces (scene-map.ts):**
- `MAP_PALETTE = { sea: "#1c3647", land: "#b9a375", river: "#2f6f9a", route: "#b3362a", routeShadow: "#6d1c14", label: "#ffffff", labelInk: "#111111", tag: "#d8ad2e", caption: "#2a2422" }` (tông trầm, không rực).
- `renderMapScene(o: MapScene): Promise<void>` với `type MapScene = { shot: Shot; places: Map<string, {lat;lon}>; out: string; fps?: number }` — vẽ từng khung bằng SVG → PNG (resvg) → ffmpeg; mũi tên tuyến mọc dần, nhãn địa danh hiện khi mũi tên chạm, nổ ở `battles`, lính chibi chạy ở đầu mũi tên, thẻ vàng `title` trượt vào, hộp chữ đáy `subtitle`.
- `chibiSoldier(o: { x: number; y: number; t: number; index: number; color: string }): string` — SVG người giấy đầu tròn, nhún theo nhịp bước.

- [ ] Test (không chạy ffmpeg): `boxFor` với 2 điểm cách nhau 1° → tỉ lệ ngang/dọc = 16/9 sau khi nhân cos; `projector` đưa góc tây-bắc về (0,0) và đông-nam về (w,h); `chibiSoldier` khác nhau ở 2 thời điểm (có nhún).
- [ ] Test khung SVG: `mapFrameSvg` (export) ở `t=0` chưa có nhãn địa danh cuối; ở `t` cuối có đủ mọi nhãn và không có chuỗi `NaN`.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): cảnh bản đồ phẳng + lính chibi`.

### Task 4: Cảnh thẻ chữ + cảnh tranh tư liệu

**Files:** Create `pipeline/scene-card.ts`, `pipeline/scene-art.ts`, `scene-card.test.ts`, `scene-art.test.ts`

**Interfaces — Produces:**
- `renderCardScene(o: { shot: Shot; out: string }): Promise<void>` — nền giấy cũ sepia + hạt, vệt cọ đỏ quét ngang, `title` (Playfair) hiện dần, `subtitle` nhỏ dưới. Tái dùng ý tưởng `history-preview.ts:yearCard`.
- `pickArtwork(o: { query: string; dir: string; dossier: Dossier; want: number }): Promise<ArtImage[]>` với `type ArtImage = { file: string; title: string; url: string; license: string; artist: string; synthetic: boolean }` — tìm Commons (`generator=search`, ns 6), **loại** ảnh hiện đại theo `MODERN_PHOTO` (tượng đài, bảo tàng, IMG_/DSC, ảnh chụp) và ảnh lạc đề (tên file không chứa từ khoá đề tài), chỉ nhận giấy phép tự do, rộng ≥900px.
- `renderArtScene(o: { shot: Shot; art: ArtImage; out: string }): Promise<void>` — ảnh trên nền mờ của chính nó, lia/đẩy chậm theo `camera`, tông sepia + viền tối; `art.synthetic` → đóng chữ "Minh họa" góc trên.
- `artCredits(images: ArtImage[]): string` — dòng ghi công cho mô tả video.

- [ ] Test `pickArtwork` (mock fetch): bỏ `File:Tượng đài Quang Trung.jpg`, bỏ `File:Gather Ye Rosebuds.jpg` (lạc đề), giữ `File:Battle at the River Tho-xuong.jpg`; giấy phép `CC BY-NC` bị loại.
- [ ] Test `artCredits` có đủ tác giả + giấy phép + URL từng ảnh.
- [ ] Test `renderCardScene` sinh đúng lệnh ffmpeg có `drawtext` với `title` đã thoát ký tự `:` và `'`.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): cảnh thẻ chữ + cảnh tranh tư liệu (lọc ảnh hiện đại/lạc đề)`.

### Task 5: Cảnh địa hình 3D trên Kaggle

**Files:** Create `pipeline/scene-terrain.ts`, `scene-terrain.test.ts`, `kaggle/terrain/scene.py`, `kaggle/terrain/run.ipynb`

**Interfaces — Consumes:** `geo-base.ts` (Task 3), `pipeline/kaggle.ts` (hàm đẩy notebook + lấy kết quả đang dùng cho i2v/Z-Image).
**Produces:**
- `TERRAIN_MAX_SECONDS_PER_VIDEO = 240` — quá ngưỡng thì cảnh `terrain` còn lại lùi về `map`.
- `renderTerrainScene(o: { shot: Shot; places: Map<string, {lat;lon}>; dir: string; out: string }): Promise<boolean>` — chuẩn bị texture + config (như `.render/geo3d/prep.mts`), đẩy sang Kaggle chạy `scene.py`, tải khung về, ghép mp4. Trả `false` khi Kaggle không chạy được (hết giờ, lỗi, quá ngưỡng) để bên gọi lùi về `map`.
- `scene.py` (Blender): địa hình Terrarium + texture bản đồ, mũi tên ống 3D mọc dần, nhãn dựng đứng có viền, điểm nổ, máy quay theo `camera` của shot; **sương mờ xa + khung rộng hơn 60%** để không lộ mép; render bằng cờ dòng lệnh `--cycles-device OPTIX` (đặt trong lệnh chạy, không trong script).

- [ ] Test `renderTerrainScene` (mock kaggle): Kaggle ném lỗi → trả `false`, không ném; tổng giây `terrain` vượt `TERRAIN_MAX_SECONDS_PER_VIDEO` → trả `false` ngay không gọi Kaggle.
- [ ] Chạy thật 1 cảnh trên Kaggle, đối chiếu: không lộ mép bản đồ, chữ không bóng đúp.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): cảnh địa hình 3D render trên Kaggle (lùi về bản đồ 2D khi hết giờ)`.

### Task 6: Âm thanh — nhạc theo đoạn, trống, tiếng hô

**Files:** Create `pipeline/history-audio.ts`, `history-audio.test.ts`; thêm nhạc vào `pipeline/music/history/` + `README.txt` ghi công

**Interfaces — Produces:**
- `HISTORY_MUSIC_MOODS = { calm: [...], march: [...], battle: [...], elegy: [...] }` — tên file trong `pipeline/music/history/` (nhạc CC BY, ghi công trong README).
- `moodOfShot(shot: Shot): keyof typeof HISTORY_MUSIC_MOODS` — `battles` không rỗng → battle; `kind === "map"` có `route` → march; `kind === "card"` → calm; cảnh cuối video → elegy.
- `musicPlan(shots: Shot[]): { file: string; start: number; end: number }[]` — gộp các cảnh liền nhau cùng mood thành một đoạn nhạc, chuyển đoạn mờ chồng 2 giây.
- `drumTrack(shots: Shot[], seconds: number): string` — chuỗi filter lavfi: trống dồn ở 2 giây đầu video và một nhịp mỗi lần cắt cảnh `battle`.
- `shoutTrack(shots: Shot[], seconds: number): string` — tiếng hô đám đông tổng hợp (nhiễu lọc dải + bao biên độ) tại các cảnh có `sfx` chứa `shout`.
- `historyAudioArgs(o: { voice: string; shots: Shot[]; seconds: number; out: string }): string[]` — lệnh ffmpeg trộn giọng (chuẩn `VOICE_LUFS`), nhạc (`MUSIC_GAIN`), trống, tiếng hô, có ducking khi có giọng.

- [ ] Test `moodOfShot` 4 nhánh; `musicPlan` gộp 3 cảnh march liền nhau thành 1 đoạn; `drumTrack` có đúng số nhịp bằng số cảnh battle + 2 nhịp mở đầu; `historyAudioArgs` chứa `sidechaincompress` (ducking) và `-c:a aac`.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): nhạc theo đoạn + trống trận + tiếng hô`.

### Task 6b: Mở đầu kiểu trailer 30–45 giây

**Files:** Create `pipeline/history-coldopen.ts`, `history-coldopen.test.ts`

**Interfaces — Consumes:** Task 1 (`Shot`), 3–6.
**Produces:**
- `COLD_OPEN_SECONDS = { min: 30, max: 45 }`
- `coldOpenShots(shots: Shot[]): Shot[]` — chọn các cảnh **căng nhất** (ưu tiên có `battles`, rồi `sfx` chứa `drum`/`shout`), cắt mỗi cảnh còn 1,5–2,5 giây, tổng nằm trong `COLD_OPEN_SECONDS`, giữ đúng thứ tự thời gian, kết bằng một `card` mang câu hỏi treo.
- `renderColdOpen(o: { shots: Shot[]; narration: Narration; dir: string; out: string }): Promise<void>` — nhịp cắt nhanh (1,5–2,5 giây), trống dồn mạnh dần, thẻ năm quét đỏ, chữ hook, kết bằng một nhịp lặng 0,5 giây rồi vào video chính.

- [ ] Test `coldOpenShots`: tổng giây nằm trong 30–45; mọi cảnh ≤2,5 giây; cảnh có `battles` được chọn trước cảnh không có; thứ tự thời gian giữ nguyên; kịch bản không có cảnh `battles` nào → vẫn trả đủ cảnh cho 30 giây.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): mở đầu kiểu trailer 30–45 giây`.

### Task 7: Ghép cả video + QC + nối vào luồng render

**Files:** Create `pipeline/history-render.ts`, `history-render.test.ts`; Modify `pipeline/render.ts` (nhánh `isHistoryStory`), `pipeline/history-script.ts` (CLI `historyvideo:<videoId>`)

**Interfaces — Consumes:** Task 1–6.
**Produces:**
- `renderHistoryVideo(videoId: number): Promise<void>` — đọc chương + hồ sơ → `narrate` (giọng History US, tempo 1) → `directScript` → `scenesToShots` → `geocodeAll` → dựng từng cảnh theo `kind` → `renderColdOpen` ghép vào đầu (lỗi/thiếu dữ liệu → lùi: terrain→map, map→card, art→AI vẽ) → nối bằng cắt thẳng (cảnh cùng đoạn) hoặc mực loang (đổi đoạn) → `historyAudioArgs` → đốt phụ đề glow → mô tả kèm nguồn + ghi công ảnh.
- `historyQc(o: { file: string; shots: Shot[]; images: ArtImage[]; seconds: number }): Promise<string[]>` — trả danh sách lỗi: lệch độ dài > 2 giây, có khoảng đen (`blackdetect`), ảnh thiếu ghi công, ảnh AI thiếu nhãn "Minh họa", cảnh dùng lại ảnh của cảnh khác. Rỗng = đạt.
- Luồng: còn lỗi QC → giữ `ready`, Telegram, **không đăng**.

- [ ] Test `historyQc` (mock ffmpeg log): lệch 3 giây → có lỗi; `blackdetect` có dòng → có lỗi; ảnh synthetic không nhãn → có lỗi; tất cả sạch → `[]`.
- [ ] Test lùi cấp: `terrain` trả `false` → gọi `renderMapScene`; `places` rỗng → gọi `renderCardScene`; `pickArtwork` trả `[]` → gọi AI vẽ và ảnh có `synthetic: true` (nhãn "Minh họa").
- [ ] Toàn bộ `pnpm exec vitest run && pnpm typecheck && pnpm lint`.
- [ ] FAIL → cài → PASS → commit `feat(lich-su): ghép video lịch sử + QC trước khi đăng`.

### Task 8: Chạy thật video đầu tiên

Không code mới (cần merge + chủ kênh xem).

- [ ] `gh workflow run render.yml -f video_id=historyvideo:<id>` cho chương 1 (Quang Trung).
- [ ] Tự kiểm: độ dài ≈ giọng đọc, không khoảng đen, 10 cảnh ngẫu nhiên đúng loại và không đè chữ, mô tả có nguồn + ghi công.
- [ ] Gửi chủ kênh link xem; ghi kết quả vào `HANDOFF.md`.
