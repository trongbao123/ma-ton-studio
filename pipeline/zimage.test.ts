import { describe, expect, it } from "vitest";
import { pickZImageScenes } from "./zimage";

const scenes = (n: number, zoomFirst = 0) => Array.from({ length: n }, (_, i) => ({ zoom: i < zoomFirst }));

describe("pickZImageScenes", () => {
  it("bỏ cảnh 2 phút đầu (zoom) và cảnh làm clip động", () => {
    const p = pickZImageScenes(scenes(20, 5), [7, 12], 100);
    expect(p).not.toContain(0);
    expect(p).not.toContain(4);
    expect(p).not.toContain(7);
    expect(p).not.toContain(12);
    expect(p).toHaveLength(13);
  });
  it("rải đều, không trùng, đúng số lượng tối đa", () => {
    const p = pickZImageScenes(scenes(85, 10), [20, 40, 60], 16);
    expect(p).toHaveLength(16);
    expect(new Set(p).size).toBe(16);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...p)).toBeGreaterThan(70);
  });
  it("tắt khi max = 0 hoặc không còn cảnh", () => {
    expect(pickZImageScenes(scenes(10), [], 0)).toEqual([]);
    expect(pickZImageScenes(scenes(3, 3), [], 5)).toEqual([]);
  });
});
