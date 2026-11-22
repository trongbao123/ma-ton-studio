import { describe, expect, it } from "vitest";
import { boxFor, BOX_PADDING, projector } from "./geo-base";

const ASPECT = 16 / 9;

describe("khung bản đồ ôm các điểm", () => {
  it("giữ đúng tỉ lệ 16:9 sau khi nhân cos(vĩ độ)", () => {
    const box = boxFor([{ lat: 20, lon: 105 }, { lat: 21, lon: 106 }], ASPECT);
    const mid = ((box.s + box.n) / 2) * (Math.PI / 180);
    const ratio = ((box.e - box.w) * Math.cos(mid)) / (box.n - box.s);
    expect(ratio).toBeCloseTo(ASPECT, 3);
  });

  it("ôm hết mọi điểm và có đệm quanh mép", () => {
    const points = [{ lat: 20, lon: 105 }, { lat: 21, lon: 106 }];
    const box = boxFor(points, ASPECT);
    for (const p of points) {
      expect(p.lat).toBeGreaterThan(box.s);
      expect(p.lat).toBeLessThan(box.n);
      expect(p.lon).toBeGreaterThan(box.w);
      expect(p.lon).toBeLessThan(box.e);
    }
    expect(box.n - box.s).toBeGreaterThan(1 * (1 + BOX_PADDING));
  });

  it("một điểm duy nhất vẫn ra khung hợp lệ, không chia cho 0", () => {
    const box = boxFor([{ lat: 20, lon: 105 }], ASPECT);
    expect(box.n).toBeGreaterThan(box.s);
    expect(box.e).toBeGreaterThan(box.w);
  });
});

describe("chiếu toạ độ lên khung hình", () => {
  it("góc tây-bắc về (0,0), góc đông-nam về (w,h)", () => {
    const box = { w: 105, e: 106, s: 20, n: 21 };
    const project = projector(box, 1920, 1080);
    expect(project(105, 21)).toEqual([0, 0]);
    const [x, y] = project(106, 20);
    expect(x).toBeCloseTo(1920, 6);
    expect(y).toBeCloseTo(1080, 6);
  });
});
