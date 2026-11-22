CREATE TABLE "places" (
	"query" text PRIMARY KEY NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
