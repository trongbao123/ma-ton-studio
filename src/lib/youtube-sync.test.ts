import { describe, expect, it } from "vitest";
import type { VideoMeta } from "@/db/schema";
import { mergeSnippet, youtubeIdFromUrl } from "./youtube-sync";

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
