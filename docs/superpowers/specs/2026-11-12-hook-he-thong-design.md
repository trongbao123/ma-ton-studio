# Bấm vào là cuốn — kể Thần Ma Táng Cổ theo kiểu truyện "hệ thống"

Ngày: 2026-11-12 · Trạng thái: chờ chủ kênh duyệt

## Vì sao

Số liệu thật của kênh Ma Tôn Truyện (vidIQ, 08–12/11/2026):

- **CTR thumbnail 0,89–1,41%** trên ~12.000 lượt hiển thị (kênh mới tạm ổn là 4–6%). YouTube đã đẩy video, người ta không bấm.
- **Giữ chân**: video chương 1 (16 phút) còn 98% ở giây 10 → **59% ở giây 20** → 32% ở giây 50 → 18% ở 1:40. Mẫu nhỏ (44 lượt) nhưng điểm rơi rất rõ.
- 10 giây đầu giọng đọc nói: *"Thần Ma Táng Cổ Thôn Thiên Lục. Chương 1. Mưa máu thần lạc. Thần ấn thôn phệ."* — đọc tên truyện + tên chương, rồi ~50 giây tả cảnh tận thế. Câu thoại đầu ở giây 52; bàn tay vàng (Thần Ấn Thôn Phệ) tới **7:23** mới xuất hiện.
- Chủ kênh tự nghe: "đoạn nào cũng chán, phải ráng ngồi nghe".

So với 3 video tu tiên hit (Trúc Cơ Tu Sĩ "Bỏ 1 Tệ Đổi 1 Năm Tu Vi" 400k view, Não Phẳng "Phàm Nhân Tu Tiên" 485k, Heaven Sub "Tu Tiên Bằng Nguyên Tử Hạt Nhân" 540k) — đọc phụ đề 5 phút đầu:

| | Hit | Ta |
|---|---|---|
| Câu đầu | thoại xung đột / câu nêu khác biệt (*"Linh căn phàm phẩm không đạt yêu cầu, lui xuống đi."*) | tên truyện + tả cảnh |
| Thoại trong 2 phút đầu | 70–90% | ~10% |
| Nói ra bàn tay vàng | 0–20 giây | 7:23 |
| Cú lật/vả mặt đầu tiên | ~48 giây | phút 8 |
| Câu hỏi tò mò nói thành lời | phút đầu | không có |

Ngôi kể KHÔNG phải điểm khác: cả 4 đều ngôi thứ ba ("hắn").

Kết luận: không phải thiếu kịch tính (chương 1 có cha hoá quái, mẹ chết, mất mắt) mà kịch tính **chôn quá sâu** dưới lớp văn tả cảnh, và **không có lời hứa** nào cho người nghe trong 20 giây đầu. Prompt hiện tại (`src/lib/story/prompts.ts`) đã ghi "2–3 câu đầu là hook", nhưng cùng lúc ra lệnh "tả bằng giác quan cụ thể (mùi máu, tiếng xương gãy…)", học mẫu từ truyện chữ dài kỳ (Đấu La, Thôn Phệ) — AI ra văn chồng tính từ.

## Mục tiêu

- Người nghe bấm vào là bị móc ngay: **tỉ lệ còn lại ở giây 30 từ ~50% lên ≥ 70%**; thời lượng xem trung bình tăng.
- **CTR từ ~1% lên ≥ 3%** nhờ tiêu đề + thumbnail nói ra cái đặc biệt.
- Cảm giác "truyện hệ thống": cứ vài phút người nghe lại được thưởng (con số tăng, kỹ năng mở khoá).

## Không làm (non-goals)

- Không mở bộ truyện mới — **giữ Thần Ma Táng Cổ** (quyết định của chủ kênh): thế giới, Lâm Uyên, Lâm Giao, Thần Ấn Thôn Phệ, các chương đã có giọng đọc.
- Không đổi ngôi kể.
- Không vẽ bảng hệ thống thành giao diện game trên hình (chỉ là lời đọc). *(Gợi ý của Claude, chủ kênh chưa phản đối.)*
- Không render lại các chương đã đọc giọng (Gemini TTS chỉ 10 lượt/ngày).
- Không ghép cốt truyện các bộ hit (quyết định cũ, xem HANDOFF).

## Phản mục tiêu (làm vậy là hỏng dù chạy đúng)

- Hook "giật tít" mà nội dung không có → người xem thấy bị lừa, rời đi nhanh hơn.
- Hệ thống nói quá nhiều, mỗi đoạn một thông báo → thành bảng số khô khan, mất cảm xúc (cảm xúc tình thân vẫn là xương sống).
- Mâu thuẫn với chương đã đăng (Thần Ấn bỗng có tính năng mà chương trước nói không có mà không giải thích).
- Tốn thêm lượt giọng đọc cho bài chưa đạt.

## Thiết kế

### 1. Thần Ấn Thôn Phệ trở thành "hệ thống" — có sự kiện trong truyện *(quyết định của Claude, chủ kênh giao)*

- Ở **chương mở tập kế tiếp chưa đọc giọng**, Thần Ấn "thức tỉnh linh trí": lần đầu lên tiếng trong thức hải Lâm Uyên. Đây vừa là cú hook của tập đó vừa hợp lý với truyện (chương 1 đã gieo: ấn bị phong ấn, vỡ phong ấn tầng một).
- Từ đó, mỗi lần thôn phệ, Thần Ấn báo bằng câu ngắn, cố định một khuôn để người nghe quen tai, ví dụ:
  *"Thôn phệ thành công. Huyết Lang Vương. Cự lực cộng ba trăm cân. Hiện tại: một nghìn hai trăm cân."*
  Mở khoá: *"Thần Ấn tầng hai mở khoá: Thôn Phệ Thần Thông — …"*
- Nhịp thưởng: khoảng **mỗi 3–4 phút nghe (~600–800 từ) có một lần** con số tăng / kỹ năng / vật phẩm. Không dồn quá 1 thông báo trong 1 đoạn.
- Ghi vào story bible + style của bộ (series 4): luật của Thần Ấn (nuốt gì được gì, giới hạn, cái giá — vd nuốt thứ quá mạnh thì phản phệ), khuôn câu thông báo, chỉ số hiện tại. Ghi bằng tay một lần (trang web hoặc script), không phải sửa prompt chung.

### 2. Luật viết mới cho mọi chương (sửa `WRITER_SYSTEM` + `chapterPrompt`)

Rút gọn và thay luật hiện có, ưu tiên 300 từ đầu:

1. Câu đầu tiên: lời thoại xung đột, lời Thần Ấn, hoặc câu nêu khác biệt. Dưới 20 từ. Không tả cảnh, không thời tiết, không tên chương.
2. Trong 300 từ đầu: có xung đột người–với–người (sỉ nhục, đe doạ, thách thức), có một câu hỏi tò mò nói thành lời, và nhắc tới Thần Ấn/bàn tay vàng.
3. Thoại ≥ 60% trong 2 phút đầu; cả chương ~40%.
4. Không quá 2 câu tả cảnh liền nhau; mỗi câu tả ≤ 15 từ; tối đa 1 hình ảnh so sánh ("như…") mỗi đoạn.
5. Bỏ luật "tả bằng giác quan cụ thể (mùi máu, tiếng xương gãy…)" — đây là nguồn văn chồng tính từ.
6. Mỗi ~600–800 từ: một phần thưởng hệ thống hoặc một cú lật.
7. Giữ: cliffhanger cuối chương, cảm xúc tình thân, tối đa 2 tên riêng mới/chương, không hồi tưởng đầu chương.
8. Mẫu học đổi từ "truyện chữ dài kỳ" sang "truyện audio hệ thống/sảng văn" — mô tả bằng đặc điểm (như bảng trên), không nêu tên/cốt truyện cụ thể của bộ nào.

### 3. Biên tập viên AI chấm 300 từ đầu *(ý của Claude)*

- Sau khi viết xong chương (trước khi tóm tắt / trước khi đọc giọng), một lượt AI rẻ (`tier: "cheap"`) chấm 300 từ đầu theo checklist mục 2 (có/không từng ý) → điểm.
- Không đạt → viết lại **chỉ phần mở đầu** (~300–500 từ) với lỗi cụ thể, ghép lại với phần còn lại; tối đa 2 lượt; vẫn không đạt thì giữ bản tốt nhất và ghi cảnh báo (không chặn pipeline).
- Không tốn lượt giọng đọc (chạy trước TTS).

### 4. Bỏ đọc tên truyện/tên chương ở đầu video

- `pipeline/render.ts:826` đang ghép `intro = "<tên truyện>. Chương N: <tên chương>."` vào lời đọc → **bỏ khỏi lời đọc**. Tên chương vẫn hiện bằng chữ trên hình (title card đang có) và trong mục lục.
- Áp dụng cho chương render từ nay; chương đã render giữ nguyên.
- Trong tập (episode) mỗi chương ghép nối tiếp: hết bản đọc tên chương ở mỗi ranh giới chương → không còn "điểm rơi" sau phần mở đầu tập.

### 5. Phần mở đầu tập (cold open) theo khuôn 0–3 / 3–20 / 20–60 giây

Đã có `coldOpen` + `hookText` trong `pipeline/episode.ts`. Sửa mô tả schema để AI viết:

| Giây | Nội dung |
|---|---|
| 0–3 | Câu bùng nổ nhất tập — ưu tiên lời thông báo Thần Ấn hoặc thoại đỉnh điểm. Đi cùng chữ HOOK + boom (đã có). |
| 3–20 | Lời dẫn nêu khác biệt trong 1 hơi: "Người khác… Lâm Uyên thì khác: hắn nuốt…, hôm nay thứ hắn định nuốt là…". |
| 20–45 | Khoảnh khắc gay cấn nhất, dừng trước kết quả, câu cuối gợi tò mò (như hiện tại). |

### 6. Tiêu đề + thumbnail nói ra bàn tay vàng

- Prompt tiêu đề (tập + chương + Short): mở bằng **cơ chế + con số/đối tượng** ("Nuốt Huyết Lang Vương, Một Quyền 1.200 Cân…"), không mở bằng tên nhân vật.
- `thumbnailText`: 2–4 chữ nói hành động/cơ chế ("NUỐT CỔ THẦN", "+300 CÂN"), **cấm tên nhân vật**.
- Thumbnail tập dài gửi kèm ảnh mẫu nam chính (`refs`) như mở đầu/Short — hiện `thumbnail()` trong `render.ts` chưa nhận `refs`, thumbnail chỉ dùng mô tả ngoại hình.

### 7. Tag cố định *(đã làm, chưa push)*

`src/lib/youtube-tags.ts`: bộ 20 tag chủ kênh chọn luôn đứng đầu mọi upload/cập nhật; tag AI lấp phần còn lại tới 500 ký tự.

## Ràng buộc

- Free: Gemini TTS 10 lượt/ngày, Codex gói Plus cho ảnh (hết thì chờ, không FLUX). Biên tập viên AI dùng tier rẻ.
- Pipeline chạy trên GitHub Actions từ `main`; máy local không có `DATABASE_URL` → sửa bible/style series 4 phải qua trang web hoặc một lệnh chạy trên Actions.
- Truyện đang ở: chương 18 chờ đọc giọng, chương 19–22 đã viết chưa đọc giọng (theo HANDOFF; cần kiểm DB). Tập 4 (#33) đang chờ ghép lại sau khi đã xoá bản cũ.

## Quyết định của Claude (sau vòng review, chủ kênh kiểm khi đọc)

1. **Luật viết mới (mục 2) áp cho MỌI bộ truyện**, sửa thẳng `WRITER_SYSTEM`/`chapterPrompt` — vì vấn đề "chán" là của cả kênh, không riêng bộ này. Phần "Thần Ấn là hệ thống" (mục 1) chỉ nằm trong bible/style của series 4.
2. **Biên tập viên AI chấm ngay sau lượt viết ĐẦU** (300 từ đầu đã cố định từ lượt đó), trước các lượt "viết tiếp" — viết lại mở đầu lúc này rẻ nhất, không phải chạy lại phần sau.
3. **Mục 5 chỉ sửa mô tả schema** `coldOpen`/`hookText`, không tách field, không ép mốc giây trong code (thời lượng do TTS quyết).
4. **Thumbnail gửi kèm ảnh mẫu cho cả 3 phương án** — cả 3 đều có nam chính; ảnh tham chiếu không tốn thêm lượt (vẫn 1 lượt vẽ/ảnh).
5. **Cảnh báo "mở đầu chưa đạt"**: ghi `track.warn` trên trang video + gửi Telegram (cơ chế có sẵn), không thêm bảng/cột mới.

## Để người làm quyết (builder)

- Chương nào là "chương thức tỉnh" và có viết lại các chương đã viết nhưng chưa đọc giọng hay không — kiểm DB trước: chương nào `videos` đã có `narration`/đã render thì không đụng.
- Khuôn câu thông báo chính xác, cách lưu "chỉ số hiện tại" của Lâm Uyên (trong bible hay trong tóm tắt chương).
- Thang điểm và ngưỡng đạt của biên tập viên AI.
- Thứ tự triển khai, miễn mục 4 (bỏ đọc tên) và mục 2 (luật viết) lên trước lượt render kế tiếp.

## Đo kết quả

So 3 tập đầu sau thay đổi với tập 1–3 hiện tại (vidIQ `audience_retention`, `thumbnail_ctr`): tỉ lệ còn lại ở 1%, 2%, 5% thời lượng; CTR 7 ngày đầu. Ghi vào HANDOFF.
