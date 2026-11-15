// Luật chung cho tiêu đề / chữ thumbnail / mở đầu tập — rút từ số liệu 11/2026: CTR ~1% vì thumbnail chỉ ghi tên nhân vật
// (người mới không biết là ai); video hit nói ra bàn tay vàng + con số + hậu quả lớn ngay ở tiêu đề và thumbnail.

export const NO_NAME_RULE = "KHÔNG dùng tên nhân vật (người mới không biết là ai) — nói hành động/cơ chế/con số";

// Khuôn GIẬT TÍT kiểu mạng xã hội (chủ kênh tự đặt 15/11/2026, vidIQ chấm 95 — cao hơn mọi gợi ý của vidIQ):
// "Thanh niên quá ngông đòi cân cả lò team địch và cái kết ăn hành ngập mồm". Kể như người xem kể lại cho bạn, bỏ ngỏ kết quả.
export const HOOK_TITLE_RULE =
  "viết kiểu GIẬT TÍT mạng xã hội, theo khuôn '[danh xưng đời thường thay cho tên: Thanh niên / Gã tạp dịch / Phế vật / Thằng nhóc / Ông chú quét rác…] " +
  "[làm điều ngông cuồng, nghịch lý hoặc bị coi thường] và cái kết [hậu quả bất ngờ nói bằng tiếng lóng mạng, bỏ ngỏ ai thắng ai thua]' " +
  "(vd 'Thanh niên quá ngông đòi cân cả lò team địch và cái kết ăn hành ngập mồm', 'Phế vật bị cả tông môn cười nhạo và cái kết khiến trưởng lão quỳ không kịp'); " +
  "GIẤU chi tiết then chốt (vidIQ 15/11: 4/6 tiêu đề cũ kể hết nên không ai bấm): nói rõ xung đột nhưng KHÔNG nói kết quả, KHÔNG nói chiêu thức/bảo vật/danh tính kẻ thù — người xem phải bấm vào mới biết; " +
  "giọng nói chuyện bình dân, KHÔNG văn vẻ Hán Việt, KHÔNG viết hoa mỗi chữ (chỉ hoa chữ cái đầu), KHÔNG tên nhân vật, KHÔNG tên truyện, KHÔNG số chương/tập, KHÔNG chèn từ khóa SEO (từ khóa để ở mô tả và tag)";

export const COLD_OPEN_RULE =
  "Nhịp: 0–3 giây là câu bùng nổ nhất tập (ưu tiên lời thông báo của bàn tay vàng hoặc câu thoại đỉnh điểm); 3–20 giây là MỘT câu nêu điều khác biệt theo mẫu 'Người khác … <nhân vật chính> thì khác: … Hôm nay, …'; phần còn lại là khoảnh khắc gay cấn nhất, dừng ngay trước kết quả";

// Chữ thumbnail theo bản chủ kênh làm tay 15/11/2026 ("THÁCH ĐẤU", vidIQ 98): 2–3 từ cực to bên phải, mặt nhân vật bên trái
// — pipeline/thumb-blast.ts vẽ. Chữ ngắn thì to được gấp đôi, đọc được cả trên điện thoại.
export const THUMB_TEXT_RULE =
  "2–3 từ IN HOA (tối đa ~16 ký tự), một động từ/khoảnh khắc gây sốc khiến người xem muốn biết chuyện gì xảy ra " +
  "(vd 'THÁCH ĐẤU', 'MỘT KIẾM DIỆT TÔNG', 'NUỐT THẦN', 'QUỲ XUỐNG!'), KHÔNG lặp nguyên văn tiêu đề, KHÔNG số tập/chương, KHÔNG tên nhân vật";
