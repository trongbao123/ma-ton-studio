CREATE TABLE "ai_usage" (
	"day" text NOT NULL,
	"model" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"limited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ai_usage_day_model" UNIQUE("day","model")
);
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "chapters_per_day" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "publish_at" timestamp with time zone;