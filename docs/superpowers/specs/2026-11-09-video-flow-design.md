# Màn Flow video kiểu n8n + tự đăng YouTube

Ngày: 2026-11-09 · Trạng thái: chờ duyệt

## Vì sao làm

Trang `/videos` hiện chỉ là danh sách nút tải file. Không xem trước được ảnh, video hay giọng đọc, cũng không biết một video đang chạy tới bước nào, AI đã làm gì, lỗi ở đâu. Người dùng muốn một công cụ **nhìn chuyên nghiệp như n8n**: thấy cả pipeline dưới dạng các node nối dây, bấm vào node nào thì xem chi tiết thứ node đó làm ra. Người dùng cũng muốn video **tự đăng YouTube theo lịch**, không phải tải về rồi đăng tay nữa.

Người dùng giao lại cho mình các quyết định về UI/UX, chỉ cần ba điều: **đẹp, dễ dùng, kéo thả được**, và **chạy ổn trên điện thoại**.

Mockup đã duyệt hướng: `.superpowers/brainstorm/295-1794236422/content/flow-v3.html`. Đó là canvas nền chấm tối, các node nối dây, node AI Agent có cổng Model/Memory/Tool với node con treo bên dưới, bảng chi tiết bên phải chia tab, thanh nhật ký dưới cùng.

## Mục tiêu

1. **Màn flow cho từng video** tại `/videos/[id]`. Canvas các node đi theo đúng pipeline thật:
   `Chương đã duyệt → AI Agent "Đạo diễn" → Giọng đọc → Vẽ ảnh cảnh → Dựng video → Đăng YouTube`
   - Node con, nối bằng dây đứt nét: dưới AI Agent có *Chat model* (model thật đã chạy), *Memory: Story bible*, *Tóm tắt chương trước*; dưới Vẽ ảnh có *Cloudflare FLUX*; dưới Đăng YouTube có *Nhãn AI + lịch đăng*.
   - Mỗi node có trạng thái riêng: chờ (mờ), đang chạy (viền xanh phát sáng, dây vào node chạy hiệu ứng), xong (xanh lá), lỗi (đỏ), bỏ qua (xám). Kèm tiến độ (`18/30`) và thời gian chạy.
   - **Tự cập nhật** khi đang render, người dùng không phải F5.
2. **Bảng chi tiết** (inspector) có 3 tab *Kết quả / Đầu vào–Prompt / Nhật ký*, nội dung khác nhau theo từng node:
   - Chương đã duyệt: tiêu đề, số chữ, giờ duyệt, đoạn mở, link sang trang chương.
   - AI Agent: tiêu đề YouTube, mô tả, tag, kịch bản Short, mô tả ngoại hình nhân vật, các prompt cảnh. Tab prompt hiện system prompt/prompt đã gửi. Hiện tên model đã chạy.
   - Giọng đọc: trình nghe thử bản đọc video dài và bản Short, thời lượng, tên giọng.
   - Vẽ ảnh cảnh: lưới **ảnh thật** từng cảnh, nhãn mốc thời gian, bấm để phóng to (lightbox), kèm prompt của ảnh đó. Có cả ảnh Short và thumbnail.
   - Dựng video: **phát video thật** (video dài và Short dọc), nút tải xuống.
   - Đăng YouTube: thẻ xem trước giống YouTube (thumbnail, tiêu đề), giờ lên lịch của video dài và Short, trạng thái upload, link YouTube, các nút copy tiêu đề/mô tả/tag (giữ chức năng cũ).
3. **Kéo thả**: kéo nền để di chuyển, cuộn hoặc chụm 2 ngón để zoom, nút zoom và nút "vừa khung", kéo node đi chỗ khác. Vị trí node được nhớ lại.
4. **Chỉnh nhanh trên node**, áp dụng cho các lần render sau của cả bộ truyện:
   - Node Giọng đọc: chọn giọng (danh sách giọng Gemini TTS, thay cho biến môi trường `TTS_VOICE` cố định).
   - Node Dựng video: bật/tắt làm Short.
   - Node Đăng YouTube: bật/tắt tự đăng.
5. **Trang `/videos`** đổi thành lưới thẻ: thumbnail, tên truyện + chương, trạng thái, giờ đăng. Bấm vào thì mở màn flow. Video đang chạy thì thẻ có thanh tiến độ.
6. **Lối vào khác**: trang chương có nút "Xem flow" nếu đã có video. Link trong tin nhắn Telegram (video sẵn sàng, render lỗi, đã đăng) trỏ thẳng tới `/videos/[id]`.
7. **Tự đăng YouTube theo lịch** ngay sau khi render xong, người dùng không phải duyệt:
   - Upload video dài, đặt lịch công khai đúng `publishAt` (giữ quy tắc 19h giờ Việt Nam, mỗi ngày 1 video như hiện tại) bằng tính năng lên lịch của chính YouTube (`privacyStatus: private` + `publishAt`).
   - Upload Short, lên lịch **sau video dài 2 tiếng**.
   - Đặt thumbnail cho video dài, bật cờ nội dung tổng hợp/AI (`containsSyntheticMedia`), điền tiêu đề, mô tả, tag.
   - Lưu link YouTube vào DB và báo Telegram "đã lên lịch đăng".
   - Render lỗi thì không đăng gì.
8. **Kết nối YouTube** một lần ngay trong app: nút "Kết nối YouTube" chạy OAuth, lưu refresh token. Có chỗ hiển thị trạng thái kết nối. Token hỏng/hết hạn thì báo Telegram, video vẫn ở trạng thái "sẵn sàng" để đăng tay như cũ.
9. **Responsive**: dùng được trên điện thoại. Từ khoảng 768px trở xuống, bảng chi tiết thành bottom sheet kéo lên được, canvas vẫn kéo và chụm zoom được.

## Thứ tự làm

Người dùng yêu cầu: **xong UI trước, rồi mới tới phần core.**

1. **Giai đoạn UI:** màn flow `/videos/[id]` (canvas React Flow, inspector, kéo thả, responsive), lưới thẻ `/videos`, lối vào từ trang chương. Chỉ dùng dữ liệu **đã có** (`videos.status`, `meta`, `assets`, nội dung chương, story bible). Phần nào chưa có dữ liệu (tiến độ từng bước, ảnh cảnh, nhật ký, trạng thái YouTube) thì hiện trạng thái trống rõ ràng, không bịa số liệu. Code phải để sẵn chỗ cho dữ liệu thật cắm vào.
2. **Giai đoạn core:** pipeline ghi tiến độ từng bước và upload ảnh cảnh, polling trực tiếp, các tùy chọn trên node (giọng, Short, tự đăng), kết nối YouTube và tự đăng theo lịch.

Mỗi giai đoạn phải deploy được và dùng được độc lập.

## Không làm (lần này)

- Tự dựng workflow kiểu n8n thật (kéo node mới vào, nối dây tùy ý để đổi cách app chạy). Pipeline vẫn cố định trong code.
- Gắn ChatGPT/Claude và chọn model trên node AI Agent. Đây là **dự án kế tiếp**. Node Chat model lần này chỉ *hiển thị* model đã chạy, nhưng UI phải để sẵn chỗ cho việc chọn model sau này.
- Chạy lại riêng từng node (vd chỉ vẽ lại ảnh 7). Vẫn chỉ có "Render lại" cả video, cache sẵn có giúp không tốn lại phần đã làm.
- Flow cho khâu viết truyện (ý tưởng → bible → dàn ý → viết chương).
- Số liệu YouTube Analytics.

## Điều phải tránh

- Đăng nhầm: đăng video lỗi, đăng trùng 2 lần cho một video (kể cả khi job chạy lại), hoặc đăng lệch lịch.
- Màn flow giật/lag hoặc đứng hình khi đang render, nhất là trên điện thoại.
- Nhìn "lỏ": chữ đè dây, node tràn ra ngoài khung, panel che node. Đây là lời chê thật của người dùng với mockup v2.
- Lộ file hoặc token: ảnh/video nằm trong release của repo private và vẫn phải đi qua đăng nhập của app (`src/proxy.ts`).

## Ràng buộc và sự thật cần biết

- **Kiểm duyệt API YouTube:** project Google Cloud chưa qua *audit* thì mọi video upload qua API đều bị khóa ở chế độ riêng tư, kể cả có `publishAt`. Người dùng đã được báo. Trong lúc chờ audit, app vẫn upload và lên lịch như thường, nên ghi rõ trạng thái này trên node Đăng YouTube ("chờ Google duyệt API, vào Studio bấm công khai"). Hồ sơ audit do người dùng tự nộp. Thiết kế này không xử lý chuyện đó, chỉ cần một đoạn hướng dẫn trong README.
- **OAuth:** ứng dụng OAuth ở chế độ *Testing* có refresh token hết hạn sau 7 ngày. README phải hướng dẫn chuyển sang *In production* (dùng cá nhân thì không cần xác minh, chỉ hiện màn cảnh báo). Scope cần có: `youtube.upload`, cộng thêm scope đủ để đặt thumbnail (`youtube` hoặc `youtube.force-ssl`, builder kiểm lại).
- **Quota YouTube Data API:** 10.000 đơn vị/ngày. Builder kiểm lại chi phí hiện tại của `videos.insert` và `thumbnails.set`. Mỗi ngày tối đa khoảng 2–4 video (dài + Short), phải nằm trong mức này.
- **Đặt thumbnail** cần kênh đã xác minh số điện thoại. Nếu bước này lỗi thì vẫn đăng video, chỉ ghi cảnh báo.
- **Hạ tầng hiện có (giữ nguyên):** web Next.js 16 trên Vercel. Render chạy trên GitHub Actions (`pipeline/render.ts`, `pipeline/daily.ts`). File lưu ở GitHub Release `video-<id>` (repo private) và tải qua `/api/videos/[id]/[file]`, route này redirect sang link ký sẵn. DB là Neon + Drizzle. Next.js bản này có thay đổi so với kiến thức cũ, xem `AGENTS.md` và đọc `node_modules/next/dist/docs/` trước khi viết code.
- Pipeline hiện **không lưu ảnh từng cảnh** và không ghi tiến độ theo bước. Cả hai phải thêm vào thì màn flow mới có dữ liệu thật.
- Repo dùng tiếng Việt cho comment, thông báo và UI. Code hiện có ít comment, comment chủ yếu giải thích "vì sao".

## Những gì đã quyết

| Quyết định | Ai quyết |
|---|---|
| Hướng giao diện theo mockup v3 (canvas + inspector 3 tab + thanh nhật ký) | người dùng duyệt |
| Tự đăng thẳng theo lịch, không cần bấm duyệt | người dùng |
| Kéo thả mức "xem + chỉnh nhanh trên node", không dựng workflow tự do | mình quyết, người dùng giao |
| Responsive cho điện thoại | người dùng |
| Mỗi video một trang flow `/videos/[id]`; `/videos` thành lưới thẻ | mình quyết |
| Short đăng sau video dài 2 tiếng | mình quyết, theo thói quen đăng tay hiện tại |
| ChatGPT/Claude để dự án sau | mình quyết |
| Màn flow luôn nền tối (kiểu n8n), các trang khác giữ theme hiện tại | mình quyết |
| Canvas dùng **React Flow** (`@xyflow/react`): sẵn kéo, zoom, cảm ứng, minimap | mình quyết |
| Upload YouTube chạy **trong job render trên GitHub Actions**, ngay sau khi tạo release (file đã sẵn trên máy, không phải chuyển qua Vercel) | mình quyết |
| Refresh token YouTube lưu trong DB (bảng cài đặt), lấy qua nút "Kết nối YouTube" trên web. Client ID/secret để trong env của Vercel và GitHub secrets | mình quyết |
| Chỉnh nhanh trên node lưu **theo bộ truyện** (cột trên `series`). Vị trí node lưu **chung một bố cục** trong DB, để điện thoại và máy tính giống nhau | mình quyết |
| Cập nhật trực tiếp bằng **polling** khoảng 3 giây khi video đang `rendering` hoặc đang upload, ngừng khi xong | mình quyết |
| Giữ nguyên enum `videoStatus`. Trạng thái YouTube ghi ở **cột riêng** trên `videos`: id video dài, id Short, trạng thái upload (`none / uploading / scheduled / failed`), lỗi upload. Upload và lên lịch thành công thì `status` chuyển `published`. Upload lỗi thì `status` vẫn `ready`, file video không sao | mình quyết |
| **Luồng đăng tay vẫn giữ lâu dài** làm phương án dự phòng: các nút copy, tải file và "Đã đăng" + ô link nằm trong inspector của node Đăng YouTube, hiện khi tự đăng tắt, chưa kết nối hoặc upload lỗi | mình quyết |
| Vị trí node là **một bố cục chung cho mọi video**, vì pipeline video nào cũng cùng hình. Kéo ở video này thì video khác cũng theo. Có nút "Sắp xếp lại" để về bố cục mặc định | mình quyết |
| Video dài và Short **chung một node** cho mỗi bước (Giọng đọc, Vẽ ảnh, Dựng video). Node hiện 2 dòng tiến độ, vd `Dài 18/30 · Short 3/5`. Inspector có nút chuyển Dài/Short. Short lỗi thì node có cảnh báo vàng chứ không chuyển đỏ (Short là phần phụ, như code hiện tại). Thumbnail nằm trong node Vẽ ảnh | mình quyết |

## Để builder tự quyết

- Cấu trúc bảng ghi tiến độ: bảng `video_steps` riêng hay một cột jsonb trên `videos`. Yêu cầu là ghi được trạng thái, tiến độ x/y, giờ bắt đầu/kết thúc, model, input/output tóm tắt và vài dòng nhật ký cho từng bước. Mức ghi phải thưa vừa đủ để không dồn DB, vd ảnh thì ghi sau mỗi ảnh xong.
- Cách đưa ảnh cảnh lên để xem trước *trong lúc* đang render: tạo release từ đầu rồi `gh release upload` dần từng ảnh, hay upload theo lô. Ràng buộc là phải qua route có đăng nhập của app và không làm render chậm đáng kể.
- Video cũ đã render trước khi có tính năng này không có dữ liệu bước: màn flow vẫn phải mở được, suy ra trạng thái từ `videos.status` và `assets`, node nào thiếu dữ liệu thì ghi "không có dữ liệu".
- Cách chống đăng trùng (vd lưu YouTube video id trước/sau khi upload và kiểm trước khi upload lại), và cách xử lý khi "Render lại" một video đã đăng.
- Thư viện client YouTube (`googleapis` hay gọi REST trực tiếp với upload resumable).
- Chi tiết chuyển động, màu, icon, miễn đúng tinh thần mockup v3 và không đè chữ.
- Trang `/videos` có lọc/phân trang hay không (hiện giới hạn 50).
