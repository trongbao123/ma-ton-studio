// Luật chung cho tiêu đề / chữ thumbnail / mở đầu tập — rút từ số liệu 11/2026: CTR ~1% vì thumbnail chỉ ghi tên nhân vật
// (người mới không biết là ai); video hit nói ra bàn tay vàng + con số + hậu quả lớn ngay ở tiêu đề và thumbnail.

export const NO_NAME_RULE = "KHÔNG dùng tên nhân vật (người mới không biết là ai) — nói hành động/cơ chế/con số";

// Khuôn của Tiểu Hồ Review (29/29 video gần nhất 52–387k view): "[xuất thân thấp/xuyên thành ai], Ta [bàn tay vàng có tên + con số], [kết quả khủng]".
export const HOOK_TITLE_RULE =
  "theo khuôn '[xuất thân thấp hoặc xuyên thành ai], Ta [thức tỉnh/có bàn tay vàng có tên riêng + con số], [kết quả khủng]' " +
  "(vd 'Tạp Dịch Bị Đánh Gần Chết, Ta Thức Tỉnh Hệ Thống Ký Danh Vạn Lần Hoàn Trả, Cả Tông Môn Quỳ Lạy'), xưng 'Ta', không mở bằng tên nhân vật";

export const COLD_OPEN_RULE =
  "Nhịp: 0–3 giây là câu bùng nổ nhất tập (ưu tiên lời thông báo của bàn tay vàng hoặc câu thoại đỉnh điểm); 3–20 giây là MỘT câu nêu điều khác biệt theo mẫu 'Người khác … <nhân vật chính> thì khác: … Hôm nay, …'; phần còn lại là khoảnh khắc gay cấn nhất, dừng ngay trước kết quả";
