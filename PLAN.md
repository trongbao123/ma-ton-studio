# Ma Tôn Studio — kế hoạch

Web tự động sản xuất video truyện tiên hiệp cho kênh YouTube "Ma Tôn Truyện".
Người dùng chỉ duyệt; AI làm phần còn lại.

## Quyết định đã chốt
| Mảng | Chọn | Lý do |
|---|---|---|
| Viết truyện | Claude API (`claude-sonnet-5`), `claude-opus-5-5` cho dàn ý/arc | Văn dài tiếng Việt tốt, giữ mạch theo story bible |
| Ảnh + thumbnail | OpenAI image API | Chất lượng cao, theo prompt tốt |
| Giọng đọc | ElevenLabs (fallback: Google Cloud TTS) | Tự nhiên nhất cho tiếng Việt |
| Dựng video | Remotion + ffmpeg (thay CapCut — không có API) | Render tự động, có zoom/chuyển cảnh/phụ đề |
| Đăng + số liệu | YouTube Data API v3 + YouTube Analytics API | vidIQ không có API, dùng tay để research |
| Stack | Next.js (web) + worker Node (BullMQ) + Postgres + Redis, chạy Docker | Một ngôn ngữ (TypeScript) |
| Chạy ở đâu | Mac local trước, lên VPS khi ổn định | Render cần CPU, local rẻ và nhanh |

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
- **P3 — Đăng**: lịch đăng, upload qua API, cắt Shorts.
- **P4 — Tối ưu**: kéo analytics, AI điều chỉnh chủ đề/tiêu đề theo retention.

## Việc người dùng phải làm (AI không làm thay được)
1. Anthropic API key — console.anthropic.com
2. OpenAI API key — platform.openai.com (khác gói ChatGPT)
3. ElevenLabs API key — elevenlabs.io (gói Creator trở lên để dùng thương mại)
4. Google Cloud project: bật YouTube Data API v3 + Analytics API, tạo OAuth client,
   gửi đơn audit để upload không bị khóa private (làm NGAY, mất vài tuần).
