ALTER TABLE "series" ADD COLUMN "tts_voice" text DEFAULT 'Algenib' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "make_short" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "auto_publish" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "progress" jsonb DEFAULT '{"steps":{}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "youtube_video_id" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "youtube_short_id" text;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "upload_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "upload_error" text;