# Ma Tôn Studio — kế hoạch

Web tự động sản xuất video truyện tiên hiệp cho kênh YouTube "Ma Tôn Truyện".
Người dùng chỉ duyệt; AI làm phần còn lại.

## Quyết định đã chốt — bản FREE
Mọi provider đi qua 1 interface (`TextProvider`, `ImageProvider`, `VoiceProvider`)
→ kênh có tiền thì đổi sang bản trả phí bằng 1 biến môi trường.

| Mảng | Free | Khi có tiền đổi sang |
|---|---|---|
| Viết truyện | Gemini API free tier (Google AI Studio) | Claude API |
| Ảnh + thumbnail | Cloudflare Workers AI (Flux) free/ngày; dự phòng Pollinations | OpenAI image API |
| Giọng đọc | Edge TTS (`vi-VN-NamMinhNeural`, `vi-VN-HoaiMyNeural`) — không chính thức | ElevenLabs |
| Dựng video | ffmpeg trên GitHub Actions (private repo: 2000 phút/tháng free) | Remotion Lambda |
| Web + cron | Vercel Hobby (cron 1 lần/ngày) | Vercel Pro |
| Database | Neon free | — |
| Lưu file | Cloudflare R2 free 10GB; xóa video sau khi đã lên YouTube | — |
| Đăng + số liệu | YouTube Data API + Analytics API (free) | — |

Luồng render: Vercel cron → gọi `workflow_dispatch` GitHub Actions → ffmpeg render
→ upload R2 → báo về Vercel → chờ duyệt → đăng YouTube.

## Chiến lược nội dung
- 1 video dài/ngày (20–40 phút, 1–2 chương) — watch time cao, RPM tốt.
- 2–3 Shorts/ngày cắt từ đoạn cao trào của video dài, dẫn về video dài.
- Một bộ truyện dài nhiều tập + playlist → người xem binge.
- Hook 30s đầu + thumbnail A/B (YouTube "Test & Compare").
- Luôn có bước người duyệt → tránh bị xếp "inauthentic content".
- Bật nhãn nội dung tổng hợp (altered/synthetic) khi upload.

## Giai đoạn
- **P1 — Viết**: story bible, dàn ý arc, viết chương, màn duyệt/sửa.
- **P2 — Video**: chia cảnh, tạo ảnh, TTS, render mp4 + phụ đề + thumbnail.
- **P3 — Đăng**: lịch đăng, cắt Shorts, xuất "gói đăng" (mp4, thumbnail, tiêu đề, mô tả, tag, chapter) để người dùng tự upload + bấm công khai. Upload qua API chỉ bật khi project Google đã qua audit (chưa audit → video bị khóa private, không tự mở công khai được).
- **P4 — Tối ưu**: kéo analytics, AI điều chỉnh chủ đề/tiêu đề theo retention.

## Việc người dùng phải làm (AI không làm thay được)
1. Gemini API key — aistudio.google.com (free)
2. (Sau này) Anthropic / OpenAI / ElevenLabs key khi chuyển bản trả phí
3. —
4. Google Cloud project: bật YouTube Data API v3 + Analytics API, tạo OAuth client,
   gửi đơn audit để upload không bị khóa private (làm NGAY, mất vài tuần).
5. Tài khoản Vercel (Hobby) — `vercel login`
6. Cloudflare (R2 + Workers AI), GitHub (Actions)
