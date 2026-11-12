// Thần Ấn Thôn Phệ thành "hệ thống" kiểu truyện audio hit: luật ghi vào bible của bộ (không sửa prompt chung),
// để mọi dàn ý/chương sau tự bám. Lệnh vận hành: render.ts "hethong:<seriesId>" (pipeline/he-thong.ts).

export const SYSTEM_MARK = "## THẦN ẤN — HỆ THỐNG";

export const SYSTEM_SECTION = `${SYSTEM_MARK}
- Thức tỉnh: ở CHƯƠNG MỞ TẬP kế tiếp được viết, Thần Ấn Thôn Phệ thức tỉnh linh trí — sau khi Lâm Uyên bị dồn tới bờ cái chết, nó lần đầu lên tiếng trong thức hải hắn. Đây là cú hook của tập đó; từ đó Thần Ấn là "hệ thống" của Lâm Uyên.
- Thông báo thôn phệ — luôn đúng khuôn, câu ngắn, số viết bằng chữ cho dễ đọc to:
  "Thôn phệ thành công. <tên thứ bị nuốt>. <chỉ số> cộng <số>. Hiện tại: <tổng>."
- Mở khoá — đúng khuôn: "Thần Ấn tầng <n> mở khoá: <tên thần thông>. <công dụng trong 1 câu>."
- Nhịp: khoảng 600–800 từ một lần có thông báo (thưởng, mở khoá, hoặc cảnh báo); không quá 1 thông báo trong một đoạn.
- Giới hạn và cái giá: nuốt thứ mạnh hơn mình quá một đại cảnh giới thì bị phản phệ (thổ huyết, chỉ số tụt tạm thời, Thần Ấn im lặng một thời gian); không nuốt được người sống đang tỉnh táo; mỗi tầng Thần Ấn cần đủ "điểm thôn phệ" mới mở.
- Tính cách: Thần Ấn ít lời, lạnh lùng, thỉnh thoảng châm chọc; biết những bí mật cổ xưa nhưng chỉ hé từng chút; KHÔNG quyết định thay Lâm Uyên.
- Chỉ số hiện tại (cự lực, cảnh giới, tầng Thần Ấn, thần thông đã mở) phải ghi lại trong tóm tắt mỗi chương để chương sau cộng tiếp cho đúng.`;

export const SYSTEM_STYLE = "Kể ngôi thứ ba, nhịp nhanh, thoại nhiều; lời Thần Ấn là câu ngắn theo khuôn cố định.";

/** Thêm mục hệ thống vào cuối bible; đã có thì giữ nguyên (chạy lệnh nhiều lần không chèn trùng). */
export function withSystemSection(bible: string) {
  return bible.includes(SYSTEM_MARK) ? bible : `${bible.trimEnd()}\n\n${SYSTEM_SECTION}`;
}

/**
 * Chương được trả về dàn ý để viết lại theo luật mới: đã viết (không còn "outline"), chưa có video nào,
 * và nằm SAU chương cuối cùng đã có video — không đụng chương đã đọc giọng/đã đăng, không tạo lỗ hổng mạch truyện.
 */
export function resettableChapters<C extends { id: number; number: number; status: string }>(list: C[], chapterIdsWithVideo: Set<number>): C[] {
  const lastWithVideo = Math.max(0, ...list.filter((c) => chapterIdsWithVideo.has(c.id)).map((c) => c.number));
  return list.filter((c) => c.status !== "outline" && !chapterIdsWithVideo.has(c.id) && c.number > lastWithVideo);
}
