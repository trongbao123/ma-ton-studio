-- 28/11/2026: bật tự chạy cho bộ lịch sử đã có trên Supabase (newhistory chống trùng nên không tạo lại được) —
-- phần dựng hình (historyauto) đã xong, daily.ts sẽ tự viết/dựng/đăng cho các bộ này vào ngày kênh lịch sử.
UPDATE series SET autopilot = true WHERE genre = 'Lịch sử' AND channel = 'lich-su';
