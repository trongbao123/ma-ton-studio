CREATE INDEX "videos_chapter_id_idx" ON "videos" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "videos_publish_at_idx" ON "videos" USING btree ("publish_at");--> statement-breakpoint
CREATE INDEX "videos_upload_status_idx" ON "videos" USING btree ("upload_status");