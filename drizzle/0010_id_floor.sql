-- 23/11/2026 chuyển Neon → Supabase, id đếm lại từ 1 → video mới trùng số với release/cache `video-<id>` của video cũ
-- (Neon tới #91) và render dùng nhầm ảnh cũ. Đẩy id mới lên từ 10000 để không bao giờ trùng dữ liệu Neon (chép sang sau).
SELECT setval(pg_get_serial_sequence('series', 'id'), GREATEST(10000, (SELECT COALESCE(MAX(id), 0) + 1 FROM series)), false);--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('chapters', 'id'), GREATEST(10000, (SELECT COALESCE(MAX(id), 0) + 1 FROM chapters)), false);--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('videos', 'id'), GREATEST(10000, (SELECT COALESCE(MAX(id), 0) + 1 FROM videos)), false);
