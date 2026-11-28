# Kênh lịch sử tự chạy trọn vòng — thiết kế (28/11/2026)

## Vì sao
Kênh "Sử Ký Kể Chuyện" (khoá `lich-su`) chưa lên được video nào:
1. Video #91 (Quang Trung) dựng 22/11 chết ở bước cất (file > 2 GiB, đã vá b8368d2), chưa chạy lại.
2. 23/11 Neon khoá — bộ #9, chương #120, video #91 kẹt ở Neon; Supabase chưa có bộ lịch sử.
3. Kênh chưa bao giờ tự chạy: phải bắn tay `historyscript:` → INSERT videos → `historyvideo:`. Ngày lịch sử (lẻ) daily bỏ
   chuyện đời mà cũng không làm lịch sử → ngày trống.
4. **Pipeline lịch sử không có tiêu đề/mô tả/thumbnail và không đăng YouTube** — `keepVideo` chỉ cất `long.mp4`, đặt `ready`.

Chủ kênh: "mọi thứ phải hay và chuẩn chỉ", "làm luôn" (tự quyết rồi báo).

## Mục tiêu
- Ngày lịch sử: tự viết kịch bản (soát sự thật như cũ) → dựng → tạo meta + thumbnail → lên lịch đăng YouTube kênh `lich-su`.
- Mở đầu kịch bản lịch sử giữ chân như chuyện đời (luật riêng + biên tập viên AI).
- Giọng Thanh Bình (VieNeu, nhánh `feat-vieneu-tts`) — đã có, merge riêng.

## Không làm / cấm
- Không nới soát sự thật: kịch bản chỉ dùng chi tiết trong hồ sơ tư liệu; tiêu đề/mô tả không bịa sự kiện.
- Không đăng video trượt QC (`HistoryQcError`) — giữ hành vi cũ: cất file, báo Telegram.
- Không render video lịch sử bằng `renderVideo()` chung (sai pipeline).
- Không để 2 job dựng cùng một video lịch sử (mỗi lượt 1,5–4,5 giờ máy).

## Cách làm (đã chọn)
**Daily chỉ điều phối, việc nặng chạy job `render.yml` riêng** (`historyauto:<seriesId>`), vì dựng lịch sử dài tới 4,5 giờ —
chạy trong daily sẽ chặn hàng đợi và dễ chạm trần 355 phút. Phương án bị loại: dựng ngay trong daily (chặn + quá giờ);
làm daily thành 2 workflow theo kênh (trùng lặp cấu hình).

1. `historyauto:<seriesId>` (pipeline/history-script.ts): có video của bộ chưa lên YouTube ở trạng thái `queued`/`failed`
   (lỗi hạ tầng, không phải QC) → dựng lại nó; không có → `writeHistoryScript` → duyệt (`approved`) → INSERT `videos` →
   dựng. Dựng xong (QC đạt) → tạo meta nếu chưa có → thumbnail → `publishToYoutube` khi `autoPublishEligible`.
2. Meta lịch sử: `generateJson` (task `meta`) với schema riêng — tiêu đề tò mò nhưng đúng sử (khuôn kênh: giấu kết cục, có
   con số/vai vế, không bịa), mô tả 2–3 đoạn + nguồn Wikipedia + **ghi công ảnh Commons bắt buộc** (`artCredits`) + ghi
   công nhạc nếu có, 15–25 tag có dấu, `thumbnailText` 2–4 từ.
3. Thumbnail: ảnh tư liệu/tranh đẹp nhất của video (ảnh Commons đã tải, không vẽ AI) + chữ to — dùng `thumbnail(..., { src })`.
4. Daily: ngày `focusChannel() === "lich-su"`, với mỗi bộ lịch sử `autopilot=true`: nếu chưa có video lịch sử nào đang
   `rendering` và kho chờ đăng < BUFFER → dispatch `render.yml` `historyauto:<id>` (lỗi dispatch chỉ báo). Bộ lịch sử bị loại
   khỏi `writeSeries` và `renderQueue` (historyauto lo trọn).
5. Chống chạy trùng: `historyauto` nhận video bằng UPDATE nguyên tử như `renderVideo`; `requeueStuck` không đụng video
   lịch sử dưới 7 giờ.
6. Tạo lại bộ trên Supabase: `newhistory` (đã có, chống trùng) — bật `autopilot=true` khi tạo vì phần dựng đã xong.
7. Mở đầu: `HISTORY_OPENING_RULES` + `HISTORY_OPENING_CHECK` (editor.ts đã nhận bộ luật theo thể loại); service bật chấm
   cho lịch sử. Viết lại phần mở dùng prompt gốc có hồ sơ tư liệu; soát sự thật lượt `finish` vẫn chạy sau → không lọt bịa.

## Để builder tự quyết
Tên hàm/file phụ, cách lấy ảnh thumbnail (ảnh art đầu tiên đạt cỡ), giọng văn prompt meta trong khuôn trên.
