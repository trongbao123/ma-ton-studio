import { describe, expect, it } from "vitest";
import { coverOf, toVideoCard } from "./studio";

describe("coverOf", () => {
  it("ưu tiên thumbnail", () => expect(coverOf({ "thumbnail.jpg": 9, "long-img-0.jpg": 3 })).toEqual({ file: "thumbnail.jpg", version: 9 }));
  it("chương nội bộ: ảnh cảnh số nhỏ nhất", () => expect(coverOf({ "long-img-10.jpg": 5, "long-img-2.jpg": 4, "long.mp4": 1 })).toEqual({ file: "long-img-2.jpg", version: 4 }));
  it("chưa có ảnh", () => expect(coverOf({ "long.mp4": 1 })).toBeNull());
});

describe("toVideoCard", () => {
  const base = {
    id: 7, status: "ready" as const, uploadStatus: "none" as const, error: null, durationSec: 120,
    publishAt: new Date("2026-11-12T08:00:00Z"), assets: { "thumbnail.jpg": 11 },
    meta: null, youtubeVideoId: null, youtubeShortId: null, progress: null,
    chapterNo: 3, chapterTitle: "Ch", seriesTitle: "S", episodeChapters: 0,
  };

  it("video KHÔNG rendering thì không cần progress — đó là lý do bỏ cột nặng nhất khỏi truy vấn", () => {
    const c = toVideoCard({ ...base, progress: null });
    expect(c.live).toBeNull();
    expect(c.pct).toBeNull();
  });
  it("đang rendering thì dùng progress để hiện tiến độ", () => {
    const c = toVideoCard({ ...base, status: "rendering", progress: { steps: { images: { state: "run" } } } as never });
    expect(c).toHaveProperty("live");
  });
  it("lấy đúng các trường thẻ cần", () => {
    const c = toVideoCard(base);
    expect(c).toMatchObject({ id: 7, status: "ready", durationSec: 120, hasThumb: true, thumbVersion: 11, chapterNo: 3, seriesTitle: "S" });
    expect(c.publishAt).toBe("2026-11-12T08:00:00.000Z");
  });
  it("meta rỗng không làm vỡ thẻ", () => {
    const c = toVideoCard({ ...base, meta: null });
    expect(c.ytThumb).toBeNull();
    expect(c.compilation).toBeNull();
    expect(c.shortClip).toBeNull();
  });
  it("chế độ tập: chương nội bộ (chưa lên YouTube, không phải bản gộp) được đánh dấu", () => {
    expect(toVideoCard({ ...base, episodeChapters: 3 }).internal).toBe(true);
    expect(toVideoCard({ ...base, episodeChapters: 0 }).internal).toBe(false);
  });
});
