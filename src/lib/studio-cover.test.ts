import { describe, expect, it } from "vitest";
import { coverOf } from "./studio";

describe("coverOf", () => {
  it("ưu tiên thumbnail", () => expect(coverOf({ "thumbnail.jpg": 9, "long-img-0.jpg": 3 })).toEqual({ file: "thumbnail.jpg", version: 9 }));
  it("chương nội bộ: ảnh cảnh số nhỏ nhất", () => expect(coverOf({ "long-img-10.jpg": 5, "long-img-2.jpg": 4, "long.mp4": 1 })).toEqual({ file: "long-img-2.jpg", version: 4 }));
  it("chưa có ảnh", () => expect(coverOf({ "long.mp4": 1 })).toBeNull());
});
