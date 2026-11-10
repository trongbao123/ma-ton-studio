import { describe, expect, it } from "vitest";
import { fluxSize } from "./images";

describe("fluxSize", () => {
  it("giữ đúng khung video dài / Short (bội số 64)", () => {
    expect(fluxSize({ width: 1280, height: 768, seed: 1 })).toBe("1280x768");
    expect(fluxSize({ width: 768, height: 1408, seed: 1 })).toBe("768x1408");
  });
  it("ảnh quá lớn thì thu về ~1,3 MP cho đỡ tiền", () => {
    const [w, h] = fluxSize({ width: 2048, height: 2048, seed: 1 }).split("x").map(Number);
    expect(w * h).toBeLessThanOrEqual(1280 * 1024 * 1.05);
    expect(w % 64).toBe(0);
    expect(h % 64).toBe(0);
  });
});
