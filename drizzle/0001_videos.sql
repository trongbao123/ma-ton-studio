CREATE TYPE "public"."video_status" AS ENUM('queued', 'rendering', 'ready', 'failed', 'published');--> statement-breakpoint
CREATE TABLE "videos" (
	"id" serial PRIMARY KEY NOT NULL,
	"chapter_id" integer NOT NULL,
	"status" "video_status" DEFAULT 'queued' NOT NULL,
	"meta" jsonb,
	"assets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duration_sec" integer,
	"error" text,
	"run_url" text,
	"youtube_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "autopilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "auto_approve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "voice_style" text DEFAULT 'giọng nam trầm, kể chuyện kiếm hiệp cổ trang, nhịp vừa, nhấn nhá ở đoạn cao trào' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;