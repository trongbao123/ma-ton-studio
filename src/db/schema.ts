import { integer, pgEnum, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const chapterStatus = pgEnum("chapter_status", ["outline", "draft", "approved"]);

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

export type Series = typeof series.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
