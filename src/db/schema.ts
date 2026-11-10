import { boolean, integer, jsonb, pgEnum, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { VideoProgress } from "@/lib/flow/progress";

export const chapterStatus = pgEnum("chapter_status", ["outline", "draft", "approved"]);
export const videoStatus = pgEnum("video_status", ["queued", "rendering", "ready", "failed", "published"]);

export const series = pgTable("series", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  genre: text("genre").notNull(),
  premise: text("premise").notNull(),
  /** Story bible: nhân vật, hệ thống cảnh giới, thế lực, bối cảnh — nguồn sự thật cho mọi chương. */
  bible: text("bible").notNull(),
  /** Giọng văn mong muốn, ví dụ "kể ngôi thứ ba, nhịp nhanh, nhiều cao trào". */
  style: text("style").notNull().default(""),
  targetWords: integer("target_words").notNull().default(4000),
  /** Mỗi sáng GitHub Actions tự viết 1 chương mới. */
  autopilot: boolean("autopilot").notNull().default(false),
  /** Tự duyệt chương AI viết và render luôn — bỏ bước người đọc duyệt (rủi ro chất lượng). */
  autoApprove: boolean("auto_approve").notNull().default(false),
  /** Số chương tối đa autopilot viết mỗi ngày (còn bị chặn bởi quota free). */
  chaptersPerDay: integer("chapters_per_day").notNull().default(2),
  /** > 0 = chế độ "tập dài mỗi ngày": số chương ghép thành 1 tập (video chương chỉ render nội bộ, không đăng lẻ). 0 = đăng từng chương. */
  episodeChapters: integer("episode_chapters").notNull().default(0),
  /** Chỉ dẫn giọng đọc cho TTS. */
  /** Giọng Gemini TTS — chỉnh trên node Giọng đọc, áp dụng từ lần render sau. */
  ttsVoice: text("tts_voice").notNull().default("Algenib"),
  makeShort: boolean("make_short").notNull().default(true),
  /** Render xong thì tự upload + lên lịch trên YouTube (cần kết nối YouTube). */
  autoPublish: boolean("auto_publish").notNull().default(true),
  voiceStyle: text("voice_style").notNull().default("giọng nam trầm, kể chuyện kiếm hiệp cổ trang, nhịp vừa, nhấn nhá ở đoạn cao trào"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const chapters = pgTable(
  "chapters",
  {
    id: serial("id").primaryKey(),
    seriesId: integer("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    outline: text("outline").notNull(),
    content: text("content").notNull().default(""),
    /** Tóm tắt ngắn sau khi viết — đưa vào prompt các chương sau để giữ mạch truyện. */
    summary: text("summary").notNull().default(""),
    status: chapterStatus("status").notNull().default("outline"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("chapters_series_number").on(t.seriesId, t.number)],
);

export type VideoMeta = {
  title: string;
  description: string;
  tags: string[];
  shortTitle: string;
  shortDescription: string;
  /** vidIQ chấm tiêu đề lúc render (nếu có key): điểm tiêu đề đã chọn + các phương án. */
  /** keywords: từ khóa người xem tìm thật (vidIQ, VN), xếp theo điểm — dùng làm từ khóa chính khi chấm/sửa SEO. */
  seo?: { titleScore?: number | null; titleOptions?: { title: string; score: number | null }[]; keywords?: string[] };
  /** Có = đây là bản gộp nhiều chương (chapterId của row = chương cuối). videoIds: các video chương đã gộp. */
  /** episode = true: đây là "Tập N" của chế độ tập dài mỗi ngày (episodeNo = N); không có = bản gộp 5 chương cũ. */
  compilation?: { seriesId: number; from: number; to: number; videoIds: number[]; episode?: boolean; episodeNo?: number };
};

/** Một lần render cho một chương: video dài + 1 Short + thumbnail, lưu ở GitHub Release `video-<id>`. */
export const videos = pgTable("videos", {
  id: serial("id").primaryKey(),
  chapterId: integer("chapter_id")
    .notNull()
    .references(() => chapters.id, { onDelete: "cascade" }),
  status: videoStatus("status").notNull().default("queued"),
  meta: jsonb("meta").$type<VideoMeta>(),
  /** Tên file asset trong release → id asset GitHub, dùng để tải qua /api/videos/[id]/[file]. */
  assets: jsonb("assets").$type<Record<string, number>>().notNull().default({}),
  durationSec: integer("duration_sec"),
  error: text("error"),
  runUrl: text("run_url"),
  youtubeUrl: text("youtube_url"),
  /** Tiến độ từng bước do pipeline ghi — màn flow đọc để hiện node, ảnh cảnh, nhật ký. */
  progress: jsonb("progress").$type<VideoProgress>().notNull().default({ steps: {} }),
  youtubeVideoId: text("youtube_video_id"),
  youtubeShortId: text("youtube_short_id"),
  uploadStatus: text("upload_status").$type<"none" | "uploading" | "scheduled" | "failed">().notNull().default("none"),
  uploadError: text("upload_error"),
  /** Khung giờ đăng — tự đăng YouTube lên lịch đúng giờ này (hoặc người dùng đặt tay trong Studio). */
  publishAt: timestamp("publish_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Series = typeof series.$inferSelect;
export type Video = typeof videos.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;

/** Cài đặt chung dạng key → JSON, vd bố cục node màn flow (dùng chung mọi video, mọi thiết bị). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Đếm lượt gọi AI theo ngày (giờ Pacific — Google reset quota free lúc 0h Pacific). */
export const aiUsage = pgTable(
  "ai_usage",
  {
    day: text("day").notNull(),
    model: text("model").notNull(),
    calls: integer("calls").notNull().default(0),
    limited: boolean("limited").notNull().default(false),
  },
  (t) => [unique("ai_usage_day_model").on(t.day, t.model)],
);
