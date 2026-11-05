CREATE TYPE "public"."chapter_status" AS ENUM('outline', 'draft', 'approved');--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"outline" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" "chapter_status" DEFAULT 'outline' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_series_number" UNIQUE("series_id","number")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"genre" text NOT NULL,
	"premise" text NOT NULL,
	"bible" text NOT NULL,
	"style" text DEFAULT '' NOT NULL,
	"target_words" integer DEFAULT 4000 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;