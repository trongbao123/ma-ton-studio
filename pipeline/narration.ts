/**
 * Lời đọc video chương = đúng nội dung chương. KHÔNG đọc "<tên truyện>. Chương N: <tên chương>." ở đầu nữa:
 * số liệu 11/2026 cho thấy 10 giây đọc tên làm mất 40% người xem ở giây 10–20. Tên chương vẫn hiện bằng chữ (title card, mục lục).
 */
export function chapterNarration(content: string) {
  return content.trim();
}
