# Sử Ký Kể Chuyện — kênh lịch sử tài liệu + Facebook Page

Ngày: 2026-11-21 · Trạng thái: chờ chủ kênh duyệt

## Vì sao

Chủ kênh mở kênh thứ 3 về **lịch sử Việt Nam và thế giới**, mục tiêu để người xem *hiểu đúng lịch sử* nhưng xem cuốn như phim. Song song nuôi **Page Facebook "Sử Ký Kể Chuyện"** (đã tạo 21/11/2026) để **kiếm tiền trên Facebook** (Content Monetization), không chỉ kéo về YouTube.

Ràng buộc gốc của chủ kênh: **không hư cấu** — "kênh lịch sử làm bậy bạ ăn gậy". Một video sai sử / dùng ảnh sai thời / ảnh có bản quyền là thất bại dù pipeline chạy đúng.

Video mẫu chủ kênh đưa (kênh Nhật kể Chiến tranh Nga–Nhật, cảng Lữ Thuận 1904, dài 29:10): tông giấy cũ sepia; chuyển cảnh bằng khói/mực loang; thẻ năm "1904年2月" với vệt cọ đỏ quét qua + chữ hiện dần; bản đồ giấy cũ có nước loang và nhãn địa danh; **tranh khắc gỗ/ảnh tư liệu thật** lia máy chậm; phụ đề trắng phát sáng; ~4–5 giây một cảnh.

## Mục tiêu

- Kênh YouTube "Sử Ký Kể Chuyện" (khoá `lich-su`): mỗi video **~45 phút**, kể trọn **một sự kiện hoặc một nhân vật**, video nào cũng xem độc lập, không chia bộ.
- Lời kể kiểu **phim tài liệu kể chuyện**: một người dẫn chuyện, mở bằng khoảnh khắc căng nhất rồi lùi lại kể vì sao dẫn tới đó.
- **Mọi chi tiết có nguồn**: kịch bản viết từ hồ sơ tư liệu gom trước; một lượt soát độc lập đối chiếu năm/tên/số với hồ sơ; chỗ sử liệu mâu thuẫn thì lời kể nói rõ ("sử chép rằng…", "có ý kiến cho rằng…"). Câu nói trích dẫn chỉ dùng câu có ghi trong sử, nói rõ theo sách nào.
- Hình: **tư liệu thật là chính** (tranh/ảnh/bản đồ cổ trên Wikimedia Commons, bản quyền rõ), **bản đồ vẽ từ dữ liệu địa lý thật**, chỉ chỗ thiếu tư liệu mới cho GPT vẽ bù — có chữ nhỏ **"Minh họa"** ở góc.
- Motion graphics như video mẫu, toàn bộ **Node + ffmpeg, free**: tông giấy cũ, chuyển cảnh khói/mực, thẻ năm, bản đồ, lia máy, phụ đề phát sáng.
- Facebook: đăng **bản 45 phút** lên Page + **3 Reels/ngày** (60–90 giây, dọc 9:16), mỗi Reel là một câu chuyện nhỏ trọn vẹn (giữ người xem trên Facebook, không phải teaser "xem tiếp trên YouTube").
- Mô tả YouTube và Facebook ghi **nguồn tham khảo + ghi công ảnh** theo giấy phép.
- Khai báo nội dung tạo bằng AI trên YouTube ở mọi video (`status.containsSyntheticMedia = true`).

## Không làm

- Không hư cấu lời thoại, cảnh, nhân vật; không "phim lịch sử dã sử".
- Không hoạt hình nhân vật thật (rig cắt ghép), không API video trả phí, không tăng clip i2v — chủ kênh giữ free; i2v làm méo mặt/giáp, hại cảm giác "đúng sử".
- Không YouTube Short (chủ kênh đã ngưng Short từ 18/11/2026 vì "bú" view video dài). Reels chỉ trên Facebook.
- Không nhiều giọng đóng vai — một người dẫn chuyện.

## Phản mục tiêu (thất bại dù chạy được)

- Sai năm, sai tên, sai kết cục; bịa câu nói gán cho nhân vật lịch sử.
- Ảnh tư liệu đặt sai sự kiện/sai người (vd tranh trận khác, thời khác) mà trông như thật.
- Ảnh giấy phép NC/ND/fair-use/không rõ → gậy bản quyền YouTube hoặc Facebook.
- Ảnh AI không có nhãn "Minh họa" mà người xem tưởng tư liệu.
- Hệ thống âm thầm chèn ảnh của cảnh khác khi thiếu ảnh (hành vi hiện tại của `drawSceneSafe`, `pipeline/render.ts:203-215`).

## Ràng buộc

- Free: GPT ảnh qua codex gói Plus; Gemini TTS **10 lượt/ngày dùng chung** với kênh Chuyện Đời (ivoi khi có key); Kaggle T4 tối đa 2 kernel.
- GitHub Actions job tối đa 360 phút (`render.yml` đang 355). Vercel `maxDuration` 300 giây → viết kịch bản nhiều lượt (như `writeChapterStep`).
- Quota YouTube API 10.000 unit/ngày dùng chung các kênh.
- Meta Reels API: chỉ đăng lên Page, **3–90 giây, 9:16, tối đa 30 Reels/24 giờ**. Content Monetization hiện **theo lời mời**, ngưỡng tham khảo ~5.000 follower + 60.000 phút xem/60 ngày; Việt Nam có trong danh sách nước hay không **chưa xác nhận** — chủ kênh tự xem mục Kiếm tiền của Page.
- Vercel Hobby: 2 cron đã dùng hết → mọi việc định kỳ mới chạy trong `/api/cron/daily` hoặc GitHub Actions `daily.yml` (cron 8:17 và 20:17 giờ VN).
- Phút GitHub Actions: repo `ma-ton-studio` **public** → runner chuẩn của GitHub không tính phút; thêm kênh không làm cạn quota (`RUNNER_LABEL=ubuntu-latest` từ 17/11/2026).
- Wikimedia API yêu cầu User-Agent mô tả client; dùng tên client chung, **không** đưa email/tên chủ kênh.

## Cách làm đã cân nhắc

| Hướng | Được | Mất |
|---|---|---|
| **A. Phim tài liệu motion graphics: ảnh + máy quay + hiệu ứng ffmpeg** ✅ | Free, tái dùng pipeline, ra video đều, hình không méo | Nhân vật không "diễn" |
| B. A + nhiều clip i2v Kaggle (~1 clip/30s) | Có người cử động | Kaggle 2 GPU dùng chung → video 45 phút chờ nhiều ngày; i2v méo mặt/giáp, sai sử |
| C. Hoạt hình cắt ghép 2D (rig tay/chân/đầu) | Giống hoạt hình nhất | GPT không vẽ ổn định 1 nhân vật tách bộ phận qua 100 cảnh; không tự chạy được |

Nguồn hình trong hướng A:

| Nguồn | Được | Mất |
|---|---|---|
| **1. Tư liệu thật là chính, GPT vẽ bù chỗ thiếu** ✅ | Đúng sử, đúng chất video mẫu | Sự kiện cổ ít tư liệu (Hùng Vương, Lý–Trần) → tỉ lệ ảnh vẽ bù cao |
| 2. Toàn GPT vẽ tranh cổ | Chủ động, đồng bộ | Dễ sai trang phục/vũ khí/tàu; mất cảm giác tư liệu |

Facebook: chỉ một hướng tự động được — app Meta for Developers + Page access token, đăng qua Graph API. Đăng tay qua Meta Business Suite không tự động.

Chủ kênh chọn **A + nguồn 1**.

## Thiết kế

### 1. Kênh và thể loại

- Kênh YouTube đã tạo 21/11/2026: **Sử Ký Kể Chuyện**, handle `@sukykechuyentv`, ID `UCRviAcP2062pyOWADwzXVAw`. Page Facebook: `https://www.facebook.com/profile.php?id=61596491473917` — id dùng cho Graph API là `1514543635066059`.
- Thêm hồ sơ `lich-su` vào `PROFILES` (`src/lib/channel-profile.ts`) **trước** khi tạo bộ (khoá chưa khai báo sẽ rơi về hashtag tiên hiệp): `youtubeTitle: "Sử Ký Kể Chuyện"`, `publishEveryDays: 3`, hashtag kiểu `#LichSu #SuKyKeChuyen #LichSuTheGioi`, playlist "Lịch Sử Kể Chuyện".
- Thể loại mới `src/lib/story/history.ts` theo mẫu `life.ts`: hằng `HISTORY_GENRE`, `isHistoryStory(s)`, bible kênh, danh sách đề tài, prompt viết, hằng số độ dài. **Không** tái dùng `isLifeStory`. Rẽ nhánh ở các chỗ `life.ts` đang rẽ: `service.ts`, `prompts.ts`, `render.ts`, `daily.ts`.
- Tạo bộ bằng CLI như `newlife` (vd `render.ts newhistory:lich-su`): một bộ `genre=HISTORY_GENRE, channel=lich-su, autopilot=true`, mỗi "chương" = một video độc lập, không gộp tập.
- **Đề tài** (quyết định của mình): danh sách khởi đầu ~20 đề tài trộn Việt Nam và thế giới, mỗi đề tài một sự kiện/nhân vật có tư liệu tốt (ưu tiên đề tài có nhiều tranh/ảnh/bản đồ trên Commons cho đợt đầu). Daily lấy đề tài kế tiếp. Chủ kênh sửa danh sách trong code/CLI; giao diện web thêm đề tài để sau.
- **Né đề tài nhạy cảm chính trị** (chủ kênh chốt: "cái gì nhạy cảm quá thì né"): không làm chiến tranh/chính trị Việt Nam sau 1945, quan hệ Việt–Trung hiện đại, Hoàng Sa–Trường Sa, biên giới 1979, và các xung đột hiện đại còn tranh cãi trên thế giới (Trung Đông đương đại, Nga–Ukraine…). Danh sách đề tài và bộ lọc đề tài mới đều kiểm luật này; trong kịch bản đề tài cổ/trung đại, không liên hệ sang chính trị hiện tại.

### 2. Hồ sơ tư liệu (bước mới, trước khi viết)

Chủ kênh 21/11/2026: "kiếm tư liệu đầy đủ từ nhiều trang web chứ thiếu gì" — đề tài mỏng KHÔNG rút ngắn video mà gom rộng hơn, nhưng **chỉ nguồn tin cậy** (lượt soát coi hồ sơ là chuẩn; lẫn trang sai thì kịch bản sai mà vẫn "đạt"). Ba lớp nguồn:
1. **Wikipedia**: bài chính (vi + en) + tối đa 5 bài liên quan lấy từ liên kết trong phần mở đầu bài tiếng Anh (nhân vật, đối thủ, địa danh, sự kiện trước/sau).
2. **Sử liệu gốc trên Wikisource**: đề tài Việt Nam tìm trong vi.wikisource các bộ sử (Đại Việt sử ký toàn thư, Khâm định Việt sử thông giám cương mục, Đại Nam thực lục, Việt sử lược, An Nam chí lược) và lấy đoạn quanh từ khoá; đề tài thế giới tìm en.wikisource (bản dịch Herodotus, Plutarch, Livy…).
3. **Web tin cậy** qua API tìm kiếm Tavily (`TAVILY_API_KEY`, free 1.000 lượt/tháng; không có key thì bỏ qua lớp này), CHỈ trong danh sách tên miền cho phép (Britannica, World History Encyclopedia, History.com, National Geographic, Smithsonian, Livius, BBC, Bảo tàng Lịch sử quốc gia, báo lớn VN…); lưu nguyên đoạn + URL.
- Mỗi nguồn ghi loại (`wikipedia` / `wikisource` / `web`), tiêu đề, URL; có trần ký tự từng loại để prompt không quá lớn. Hồ sơ dưới ngưỡng tối thiểu → báo lỗi, không viết.
- Khi nguồn mâu thuẫn: lời kể nói rõ; ưu tiên sử liệu gốc và bách khoa (Britannica) hơn báo.
- Lưu hồ sơ cùng chương (`chapters.dossier`), dùng cho lượt viết, lượt soát và mục "Nguồn tham khảo" của mô tả video.

### 3. Kịch bản

- ~**7.500 từ** cho ~45 phút (nhịp tài liệu chậm hơn kênh truyện; **không** áp `NARRATION_TEMPO` ×1,2). Builder hiệu chỉnh số từ theo tốc độ giọng thật.
- Viết nhiều lượt như `writeChapterStep` (start/continue/finish), mỗi lượt nhận hồ sơ + phần đã viết.
- Luật viết: chỉ dùng chi tiết có trong hồ sơ; không thoại bịa; câu trích dẫn phải nằm nguyên văn trong hồ sơ kèm tên sách; sử liệu mâu thuẫn → nói cả hai; mở đầu in medias res (khoảnh khắc căng nhất) rồi lùi lại; kết bằng hệ quả lịch sử, không giảng đạo lý.
- **Lượt soát sự thật** (lượt AI riêng, khác lượt viết): tách mọi khẳng định có năm/tên/số/địa danh/câu trích, đối chiếu hồ sơ → `ủng hộ / không có trong hồ sơ / mâu thuẫn`. Có mục không ủng hộ → viết lại đoạn đó (≤ 2 vòng). Vẫn còn → **không render**, đề tài chuyển trạng thái "chờ sửa", gửi Telegram cho chủ kênh kèm danh sách mục lỗi; daily **nhảy sang đề tài kế tiếp** để giữ lịch 3 ngày/video (quyết định của mình).
- Kịch bản đồng thời sinh **danh sách cảnh**, mỗi cảnh một loại: `tu-lieu` (từ khoá tìm Commons + mô tả nội dung cần), `ban-do` (vùng, địa danh, mũi tên di chuyển), `the-nam` (năm/tháng + tiêu đề phụ), `minh-hoa` (prompt GPT, chỉ khi không có tư liệu phù hợp).

### 4. Ảnh tư liệu (Wikimedia Commons)

- Tìm file theo từ khoá cảnh; lấy metadata giấy phép, tác giả, URL nguồn.
- **Chỉ nhận**: Public domain, CC0, CC BY, CC BY-SA. Loại NC, ND, fair use, giấy phép không đọc được.
- Lọc độ phân giải tối thiểu; ảnh không phải 16:9 thì đặt trên nền mờ của chính nó, lia trong khung.
- **Kiểm đúng nội dung**: mô tả/chú thích của file phải khớp sự kiện/người/thời kỳ của cảnh (kiểm bằng AI đọc tiêu đề + mô tả file, có thể kèm nhìn ảnh). Không khớp → thử ảnh kế, hết thì xuống `minh-hoa`.
- Ghi công: danh sách "Ảnh: <tên file> — <tác giả> — <giấy phép> — <URL>" đưa vào mô tả YouTube/Facebook.
- **Tắt hành vi chép ảnh cảnh bên cạnh** của `drawSceneSafe` cho thể loại này: cảnh thiếu ảnh → `minh-hoa`; minh họa cũng lỗi → nền giấy cũ + chữ (không phải ảnh của cảnh khác).

### 5. Bản đồ

- Vẽ từ **dữ liệu địa lý thật** (đường bờ biển, sông, địa hình công khai như Natural Earth), không để AI vẽ bản đồ.
- Không vẽ biên giới hiện đại (sai thời); chỉ bờ biển, sông, điểm địa danh, nhãn chữ, mũi tên hành quân, vùng tô màu loang.
- Phong cách giấy cũ như video mẫu: nền giấy, nước xanh loang, nhãn thư pháp/serif, nước loang dần khi xuất hiện.
- Công cụ dựng (SVG → PNG hay khác) để builder chọn, miễn chạy được trên runner GitHub.

### 6. Dựng hình (motion graphics)

Nhánh dựng riêng cho thể loại lịch sử, tái dùng `zoompan`/xfade/ASS có sẵn trong `render.ts`:
- **Tông**: grade sepia + texture giấy phủ toàn video + glow nhẹ.
- **Chuyển cảnh khói/mực**: mặt nạ khói (sinh thủ tục bằng ffmpeg hoặc texture free bản quyền rõ) che cảnh cũ → hé cảnh mới. Không dùng ở mọi cut — chỉ đổi đoạn/đổi thời; cut trong đoạn là cắt thẳng hoặc xfade ngắn.
- **Thẻ năm**: vệt cọ đỏ quét + chữ năm hiện dần + tiêu đề phụ (ASS + ảnh vệt cọ), xuất hiện khi kịch bản nhảy mốc thời gian.
- **Lia máy**: ảnh tư liệu lia/đẩy chậm, ~4–6 giây một cảnh như video mẫu.
- **Phụ đề**: trắng phát sáng đáy màn hình, đốt cứng.
- **Nhãn "Minh họa"**: chữ nhỏ góc trên mọi khung từ ảnh GPT.
- Nhạc nền: nhạc tài liệu nhẹ, bản quyền rõ (cùng cơ chế nhạc hiện có).
- 45 phút phải dựng xong trong 1 job ≤ 355 phút (video 90 phút hiện mất ~2 giờ 45).

### 6b. Âm thanh + mở đầu (chủ kênh 21/11/2026: "nhạc, giọng, tiếng hô tướng sĩ và sĩ khí, mở truyện bánh cuốn")

- **Nhạc nền sử thi** đổi theo đoạn: bối cảnh trầm → hành quân dồn dập → giao chiến cao trào → kết lắng. Nhạc giấy phép rõ (CC BY / CC0, vd Kevin MacLeod như kênh Chuyện Đời), ghi công trong mô tả; ducking khi có giọng.
- **Âm thanh chiến trận theo cảnh** (kịch bản/cảnh gắn nhãn): tiếng hô xung trận của đám đông, trống thúc quân, tù và/kèn, ngựa hí, binh khí, nổ/pháo, sóng nước, mưa gió, lửa. Nguồn CC0/giấy phép rõ, lưu trong repo kèm ghi công. Tiếng hô là **tiếng gào không thành lời**; câu hô có chữ (vd "Sát Thát!") chỉ dùng khi câu đó có nguyên văn trong hồ sơ của video (luật không hư cấu).
- **Mở đầu như trailer 30–45 giây**: cold open dựng riêng — khoảnh khắc căng nhất của kịch bản (HỒI 1 đã mở in medias res), trống dồn + tiếng hô, thẻ năm quét đỏ, câu hỏi treo, rồi vào kể. Học cơ chế cold open đang chạy ở kênh tiên hiệp (`coldOpenClips`, HOOK_ZONE).

### 6c. Hình kiểu "đạo diễn" (chủ kênh 22/11/2026 — thay cho ảnh hiện vật bảo tàng, bị chê)

- **Cấm ảnh chụp hiện vật bảo tàng / tượng đài / ảnh chụp hiện đại.** Video mẫu không dùng loại này.
- Phong cách kết hợp (chủ kênh chọn): bối cảnh/mở/kết = giấy cũ sepia + tranh khắc; hành quân/giao chiến = bản đồ phẳng đậm (thẻ ngày vàng, nhãn chữ to, mũi tên cong có quân chạy, nổ, hộp chữ đáy) + **người giấy 2D/2.5D** (AI vẽ nhân vật cắt giấy theo đúng thời, tách nền, cử động: đi nhún, vung giáo, ngựa phi, ngã).
- **Bản đồ địa hình 3D** (Blender, độ cao thật Terrarium/SRTM, texture bản đồ phẳng đậm, mũi tên ống 3D, chữ dựng đứng) cho cảnh đắt giá (~2–4 phút/video). Render trên **Kaggle GPU** (T4, ~30 giờ/tuần dùng chung) — hết giờ thì cảnh đó tự lùi về bản đồ 2D. Đã dựng thử trên máy chủ kênh (RTX 3060).
- **Claude đạo diễn dựng**: mỗi câu kịch bản → danh sách cảnh (loại cảnh, điểm cắt theo khoảng lặng giọng, máy quay đứng/đẩy nhẹ ≤10%/lia mượt, chữ bật lên, trống/tiếng hô). Luật: không zoom giật trong một cảnh — đổi vùng thì cắt sang cảnh mới; cảnh 3–6 giây; chữ/nhãn/nhân vật không đè nhau. Dựng xong Claude soi khung hình (vision) và tự sửa.
- Toạ độ địa danh: OpenStreetMap Nominatim (≤1 lượt/giây, User-Agent chung), kiểm nằm trong vùng đề tài; đường bờ biển/sông: Natural Earth (public domain).

### 7. Giọng đọc

Một giọng nam trầm, nhịp tài liệu. Dùng ivoi khi có key, không thì Gemini — cơ chế `narrate` hiện có, không nhân `NARRATION_TEMPO`. Kho giọng ivoi hiện tại (`IVOI_VOICES`) chưa có giọng hợp tài liệu (giọng nam đang có là "Ngạn Anh" người già và giọng tiên hiệp) → **trước khi chốt**, đọc thử một đoạn kịch bản bằng 3–4 giọng ivoi/Gemini, gửi chủ kênh nghe chọn (quyết định của mình). Vì TTS dùng chung, video lịch sử xếp hàng cùng kênh Chuyện Đời theo nhịp `publishEveryDays`.

### 8. Tiêu đề, thumbnail, mô tả

- Thumbnail: tư liệu/tranh mạnh nhất của video + 2–3 chữ to (khuôn chữ nổ hiện có `thumb-blast.ts`), tông giấy cũ.
- Tiêu đề: giật nhưng **không sai sự thật**; khác kênh truyện, **được** có tên sự kiện/nhân vật lịch sử vì người ta tìm theo tên (chủ kênh "ok" với đề xuất này). Vd: *"Trận Bạch Đằng 1288: Ba Lần Đánh Bại Đế Chế Mạnh Nhất Thế Giới"*.
- Mô tả: tóm tắt + mốc thời gian chương + **Nguồn tham khảo** (URL bài trong hồ sơ) + **Ghi công ảnh**.
- Bật `containsSyntheticMedia` khi upload YouTube.

### 9. Facebook Page

- **Làm phần Facebook ĐẦU TIÊN**: rủi ro lớn nhất về thời gian là quyền đăng video/Reels của app có thể cần Meta App Review hoặc xác minh doanh nghiệp (nhiều ngày). Bước đầu của kế hoạch là kết nối thử + đăng thử 1 Reel lên Page (app ở chế độ Development, chủ kênh là admin app) để biết có bị chặn không, và bài đăng có hiện công khai không.
- **Kết nối**: app Meta for Developers của chủ kênh; lấy Page access token dài hạn; lưu **mã hoá** trong `app_settings` theo khoá kênh (vd `facebook:lich-su`), theo mẫu token YouTube (`src/lib/youtube.ts`), không dùng biến env đơn — để kênh khác có Page riêng sau này.
- **Video dài**: sau khi YouTube đăng, đăng bản 45 phút lên Page (Graph API video upload có resumable) cùng mô tả + nguồn + ghi công.
- **Reels**: từ mỗi video chọn **4–6 đoạn** 60–90 giây, mỗi đoạn là một chuyện nhỏ trọn vẹn (có mở – thắt – kết) — AI chọn theo kịch bản + mốc thời gian giọng. **Dựng lại dọc 9:16** từ cùng ảnh (không crop khung ngang), phụ đề to, câu móc ở 2 giây đầu. Giọng cắt từ audio dài (không tốn thêm lượt TTS).
- **Lịch**: hàng đợi Reels, **3 Reels/ngày** rải giờ; dùng hẹn giờ đăng của Meta nếu API hỗ trợ, không thì đăng ở các lượt daily. Một video ra mỗi ~3 ngày × 4–6 Reels ≈ đủ 3/ngày; hết hàng đợi thì bỏ trống, không đăng lặp.
- Lỗi token/hết hạn → Telegram cho chủ kênh, không làm hỏng luồng YouTube.

### 10. Kiểm tra trước khi đăng (QC)

Video lịch sử chỉ được đăng khi: lượt soát sự thật đạt; mọi ảnh tư liệu có giấy phép hợp lệ + ghi công; mọi ảnh GPT có nhãn "Minh họa"; không có cảnh nào dùng ảnh của cảnh khác; không khoảng đen (blackdetect). Thiếu một điều → giữ `ready` chờ, Telegram cho chủ kênh.

### 11. Trang quản lý + webhook Facebook (chủ kênh thêm 21/11/2026; "làm full" → trang quản lý làm SỚM, ngay sau tư liệu; webhook/số liệu khi có video)

Chủ kênh: "với UI mới đi nha chứ khó quản lý lắm" + "bắt webhook rồi kéo về làm nhiệm vụ" — chọn 1, 3, 4:
- **Trang quản lý kênh lịch sử** trên web: danh sách đề tài + trạng thái (chưa viết / đang viết / chờ sửa / có video), nút viết kịch bản, xem & sửa lỗi sự thật, hàng chờ Reels/video Facebook (xem trước, caption, đăng / tải nháp).
- **(1) Bình luận Facebook**: webhook Page (`feed` — comment) → AI trả lời dưới tên Page, CHỈ dựa vào hồ sơ tư liệu của video đó (không bịa; câu hỏi ngoài hồ sơ thì trả lời lịch sự là chưa có nguồn); bình luận tiêu cực/nhạy cảm/spam → không trả lời, báo Telegram.
- **(3) Trạng thái bài đăng**: webhook video/Reel xử lý xong hoặc lỗi → cập nhật trạng thái trên web; lỗi xử lý thì tự đăng lại 1 lần, vẫn lỗi → Telegram.
- **(4) Số liệu**: định kỳ (trong cron daily) kéo lượt xem/tương tác Reel + video từ Graph API về web để so Reel nào ăn view.
- Webhook cần route công khai trên Vercel có kiểm chữ ký `X-Hub-Signature-256` bằng App Secret + verify token; app "Su Ky Publisher" đăng ký nhận sự kiện Page.

## Việc chủ kênh tự làm

- Lập kênh YouTube "Sử Ký Kể Chuyện" trên cùng account Google, kết nối qua web (`/api/youtube/connect?channel=lich-su`).
- Tạo app Meta for Developers, cấp quyền Page, đưa token cho hệ thống (builder viết hướng dẫn từng bước).
- Kiểm mục Kiếm tiền của Page xem Việt Nam có đủ điều kiện.

## Để builder quyết

Chỗ lưu hồ sơ tư liệu và hàng đợi Reels (cột/bảng mới); cách sinh mặt nạ khói; công cụ dựng bản đồ; ngưỡng độ phân giải; mô hình dùng cho viết/soát/kiểm ảnh (theo routing AI hiện có); số từ chính xác sau khi đo giọng; giờ rải Reels.

## Câu hỏi còn mở

Không còn. Phép thử Facebook (mục 9) có thể đổi lịch nếu Meta đòi App Review.
