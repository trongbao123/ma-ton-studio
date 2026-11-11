/**
 * Đường dẫn KHÔNG qua cổng đăng nhập của proxy.ts. Mỗi đường dẫn ở đây phải TỰ kiểm quyền bên trong route.
 *
 * - `/about`, `/privacy`, `/login`: Google bắt buộc công khai để duyệt OAuth; không chứa dữ liệu.
 * - `/api/youtube/websub`: hub của Google gọi không đăng nhập — route tự kiểm chữ ký HMAC.
 * - `/api/cron/daily`: Vercel Cron gọi với `Authorization: Bearer CRON_SECRET` — route tự kiểm (cronAuth),
 *   chưa đặt secret thì trả 503 chứ không chạy.
 * - `/api/i2v/progress`: kernel Kaggle gọi với `Authorization: Bearer I2V_PROGRESS_TOKEN` — route tự kiểm;
 *   GET chỉ trả số bước/giây/VRAM nên để đọc công khai được.
 *
 * Máy ngoài gọi thì KHÔNG có cookie phiên, nên thiếu ở đây là proxy trả 401 trước khi vào route — tính năng chết câm.
 */
export const PUBLIC_PATHS = new Set([
  "/about",
  "/privacy",
  "/login",
  "/api/youtube/websub",
  "/api/cron/daily",
  "/api/i2v/progress",
]);
