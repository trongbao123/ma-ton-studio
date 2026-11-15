import { describe, expect, it } from "vitest";
import { pickBestThumb, thumbFile } from "./thumb-plan";

describe("pickBestThumb", () => {
  it("lấy phương án điểm cao nhất", () => {
    expect(pickBestThumb({ a: 60, b: 71, c: 65 })).toBe("b");
    expect(pickBestThumb({ a: 60, b: 61, c: 90 })).toBe("c");
  });
  it("hoà thì lấy phương án đứng trước", () => {
    expect(pickBestThumb({ a: 70, b: 70, c: 70 })).toBe("a");
    expect(pickBestThumb({ a: 50, b: 70, c: 70 })).toBe("b");
  });
  it("không chấm được (null / thiếu) → (a)", () => {
    expect(pickBestThumb({ a: null, b: null, c: null })).toBe("a");
    expect(pickBestThumb({})).toBe("a");
  });
  it("bỏ phương án null, chỉ xét phương án có ảnh", () => {
    expect(pickBestThumb({ a: null, b: 40, c: 30 })).toBe("b");
    expect(pickBestThumb({ a: 10, b: 99, c: 30 }, ["a", "c"])).toBe("c");
    expect(pickBestThumb({ a: 0, b: null, c: null })).toBe("a");
  });
  it("tên file", () => expect(thumbFile("b")).toBe("thumb-b.jpg"));
});
