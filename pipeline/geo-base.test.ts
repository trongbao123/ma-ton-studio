import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { boxFor, BOX_PADDING, GEO_FILES, loadShapes, projector } from "./geo-base";

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

describe("dùng lại hình nền đã đọc", () => {
  /** Thư mục giả lập dữ liệu Natural Earth: 3 file bé xíu, khỏi tải 30 MB thật. */
  async function fakeGeoDir(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "geo-base-"));
    const line = JSON.stringify({ features: [{ geometry: { type: "LineString", coordinates: [[105.5, 20.5], [105.6, 20.6]] } }] });
    for (const name of GEO_FILES) await writeFile(path.join(dir, `${name}.geojson`), line);
    return dir;
  }

  it("hai lần cùng khung trả về đúng hình đã đọc, không đọc lại file", async () => {
    const dir = await fakeGeoDir();
    try {
      const box = { w: 105, e: 106, s: 20, n: 21 };
      const first = await loadShapes(box, dir);
      expect(first.coast).toHaveLength(1);
      // Đọc lại file thì phải ra hình MỚI; cùng một hình nghĩa là lấy từ bộ nhớ.
      expect(await loadShapes(box, dir)).toBe(first);
      expect(await loadShapes({ w: 0, e: 1, s: 0, n: 1 }, dir)).not.toBe(first);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
