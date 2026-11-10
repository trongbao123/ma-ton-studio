import { describe, expect, it } from "vitest";
import type { VideoMeta } from "@/db/schema";
import { bestThumb, mergeSnippet, youtubeIdFromUrl, youtubePatch } from "./youtube-sync";

const meta: VideoMeta = {
  title: "Lâm Uyên thức tỉnh Ám Ảnh Ma Đồng | Chương 3",
  description: "Mô tả cũ",
  tags: ["truyện tu tiên"],
  shortTitle: "Short cũ #shorts",
  shortDescription: "Xem full #shorts",
  seo: { titleScore: 91, keywords: ["truyện tu tiên"] },
};

describe("mergeSnippet", () => {
  it("giống hệt (kể cả khác \r\n, khoảng trắng cuối) thì không đổi", () => {
    expect(mergeSnippet(meta, { title: meta.title, description: "Mô tả cũ\r\n", tags: ["truyện tu tiên"] }, "long")).toBeNull();
  });
  it("người dùng sửa tiêu đề trên YouTube: lấy bản YouTube, bỏ điểm vidIQ cũ, giữ từ khóa", () => {
    const r = mergeSnippet(meta, { title: "Sương độc ăn mòn, đồng đội phản bội", description: "Mô tả cũ", tags: ["truyện tu tiên"] }, "long")!;
    expect(r.title).toBe("Sương độc ăn mòn, đồng đội phản bội");
    expect(r.seo).toEqual({ titleScore: null, keywords: ["truyện tu tiên"] });
  });
  it("chỉ sửa mô tả / tag thì giữ điểm vidIQ của tiêu đề", () => {
    const r = mergeSnippet(meta, { title: meta.title, description: "Mô tả mới", tags: ["truyện audio"] }, "long")!;
    expect(r).toMatchObject({ description: "Mô tả mới", tags: ["truyện audio"], seo: { titleScore: 91 } });
  });
  it("Short chỉ cập nhật tiêu đề + mô tả Short, không đụng tag video dài", () => {
    const r = mergeSnippet(meta, { title: "Short mới #shorts", description: "Xem full #shorts", tags: ["x"] }, "short")!;
    expect(r).toMatchObject({ shortTitle: "Short mới #shorts", tags: ["truyện tu tiên"], title: meta.title });
  });
});

describe("youtubeIdFromUrl", () => {
  it("đọc được các dạng link", () => {
    expect(youtubeIdFromUrl("https://www.youtube.com/watch?v=lyh4iPDZscM")).toBe("lyh4iPDZscM");
    expect(youtubeIdFromUrl("https://youtu.be/TfiX_eE0oGA?t=3")).toBe("TfiX_eE0oGA");
    expect(youtubeIdFromUrl("https://youtube.com/shorts/Q0JcrkHIqwM")).toBe("Q0JcrkHIqwM");
    expect(youtubeIdFromUrl(null)).toBeNull();
  });
});

describe("youtubePatch", () => {
  const info = (o: Partial<import("./youtube-sync").YtInfo> = {}) => ({
    snippet: { title: meta.title, description: "Mô tả cũ", tags: ["truyện tu tiên"] },
    thumb: "https://i.ytimg.com/vi/64x3Yi4MMYQ/maxresdefault.jpg?v=abc",
    privacy: "public",
    scheduledAt: null,
    publishedAt: "2026-11-10T14:30:00Z",
    ...o,
  });
  it("bấm công khai sớm: giờ đăng = giờ công khai thật, lưu thumbnail + privacy", () => {
    const p = youtubePatch({ meta, publishAt: new Date("2026-11-11T08:00:00Z"), youtubeVideoId: "64x3Yi4MMYQ" }, { id: "64x3Yi4MMYQ", info: info() }, null)!;
    expect(p.publishAt?.toISOString()).toBe("2026-11-10T14:30:00.000Z");
    expect(p.meta?.yt).toEqual({ thumb: "https://i.ytimg.com/vi/64x3Yi4MMYQ/maxresdefault.jpg?v=abc", privacy: "public" });
    expect(p.youtubeVideoId).toBeUndefined();
  });
  it("đã khớp hết thì không ghi gì", () => {
    const synced = { ...meta, yt: { thumb: info().thumb, privacy: "public" } };
    expect(youtubePatch({ meta: synced, publishAt: new Date("2026-11-10T14:30:00Z"), youtubeVideoId: "x" }, { id: "x", info: info() }, null)).toBeNull();
  });
  it("riêng tư có hẹn → giờ hẹn; video đăng tay chỉ có link → điền id", () => {
    const p = youtubePatch({ meta, publishAt: null, youtubeVideoId: null }, { id: "lyh4iPDZscM", info: info({ privacy: "private", scheduledAt: "2026-11-12T08:00:00Z" }) }, null)!;
    expect(p.publishAt?.toISOString()).toBe("2026-11-12T08:00:00.000Z");
    expect(p.youtubeVideoId).toBe("lyh4iPDZscM");
  });
});

describe("bestThumb", () => {
  it("ưu tiên maxres, gắn ?v= theo etag", () => {
    expect(bestThumb({ maxres: { url: "https://i.ytimg.com/a/maxres.jpg" }, high: { url: "h" } }, "etag-xyz")).toBe("https://i.ytimg.com/a/maxres.jpg?v=etag-xyz");
    expect(bestThumb({ high: { url: "h.jpg" }, medium: { url: "m.jpg" } }, undefined)).toBe("m.jpg");
    expect(bestThumb(undefined, "x")).toBeNull();
  });
});
