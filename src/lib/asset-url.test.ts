import { describe, expect, it } from "vitest";
import { assetUrl } from "./asset-url";

describe("assetUrl", () => {
  it("gắn id asset làm version để đổi asset thì đổi URL", () => {
    expect(assetUrl(12, "thumbnail.jpg", 730231318)).toBe("/api/videos/12/thumbnail.jpg?v=730231318");
  });
  it("không có version thì URL trơn", () => {
    expect(assetUrl(12, "long.mp4", null)).toBe("/api/videos/12/long.mp4");
    expect(assetUrl(12, "long.mp4", undefined)).toBe("/api/videos/12/long.mp4");
  });
});
