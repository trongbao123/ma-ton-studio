/** Tên kênh hiển thị — đổi tên kênh thì chỉ sửa ở đây (tên trên YouTube phải đổi tay trong Studio). */
export const CHANNEL_NAME = "Thôn Phệ Audio";

/**
 * Link kênh dùng trong mô tả/bình luận. Mặc định theo ID kênh (không bao giờ đổi) thay vì handle @…,
 * để đổi handle trong Studio không làm gãy link "Đăng ký kênh" ở các video đã đăng.
 */
export const CHANNEL_URL = process.env.YOUTUBE_CHANNEL_URL ?? "https://www.youtube.com/channel/UCqhzR8PL3keqni2-kzbAoaw";
