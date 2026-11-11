import { describe, expect, it } from "vitest";
import { boxBlur, buildLayerMasks, inpaintBlur, normalizeDepth, parsePgm, toPgm, toPpm } from "./parallax-masks";

const SIZE = 64;
/** Độ sâu giả: nửa trái xa (0), hình vuông giữa gần (1), nền còn lại giữa (0,5). */
function fakeDepth() {
  const d = new Float32Array(SIZE * SIZE).fill(0);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (x >= SIZE / 2) d[y * SIZE + x] = 0.5;
    if (x >= 40 && x < 56 && y >= 20 && y < 44) d[y * SIZE + x] = 1;
  }
  return d;
}
const flatRgb = (r: number, g: number, b: number) => Uint8Array.from({ length: SIZE * SIZE * 3 }, (_, i) => [r, g, b][i % 3]);

describe("normalizeDepth", () => {
  it("đưa về 0–1 theo phân vị, thứ tự giữ nguyên", () => {
    const out = normalizeDepth([10, 20, 30, 40, 50]);
    expect(Math.min(...out)).toBe(0);
    expect(Math.max(...out)).toBe(1);
    expect(out[1]).toBeLessThan(out[3]);
  });
  it("ảnh phẳng thì không chia cho 0", () => {
    expect([...normalizeDepth([3, 3, 3, 3])]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe("boxBlur", () => {
  it("giữ nguyên ảnh phẳng và bảo toàn giá trị trung bình xấp xỉ", () => {
    const flat = new Float32Array(SIZE * SIZE).fill(0.7);
    expect(boxBlur(flat, SIZE, 5)[SIZE * 10 + 10]).toBeCloseTo(0.7);
  });
});

describe("buildLayerMasks", () => {
  const rgb = flatRgb(100, 120, 140);
  const m = buildLayerMasks(fakeDepth(), rgb, SIZE);
  const at = (a: Uint8Array, x: number, y: number) => a[y * SIZE + x];
  it("vật gần thuộc cả lớp giữa lẫn lớp gần; nền xa thì không thuộc lớp nào", () => {
    expect(at(m.near, 48, 32)).toBeGreaterThan(240);
    expect(at(m.mid, 48, 32)).toBeGreaterThan(240);
    expect(at(m.near, 4, 32)).toBe(0);
    expect(at(m.mid, 4, 32)).toBe(0);
  });
  it("nền giữa thuộc lớp giữa nhưng không thuộc lớp gần", () => {
    expect(at(m.mid, 34, 5)).toBeGreaterThan(240);
    expect(at(m.near, 34, 5)).toBe(0);
  });
  it("miếng vá chỉ hiện ở vùng lớp trên đặc, không hiện ở nền xa (khung đầu không có quầng)", () => {
    expect(at(m.farPatch, 48, 32)).toBeGreaterThan(240);
    expect(at(m.farPatch, 4, 32)).toBe(0);
    expect(at(m.midPatch, 4, 32)).toBe(0);
  });
  it("kích thước các mảng khớp size²", () => {
    for (const a of [m.mid, m.near, m.farPatch, m.midPatch]) expect(a).toHaveLength(SIZE * SIZE);
    expect(m.farFill).toHaveLength(SIZE * SIZE * 3);
  });
});

describe("inpaintBlur", () => {
  it("vá lỗ bằng màu vùng xung quanh, giữ nguyên chỗ đã biết", () => {
    const rgb = flatRgb(0, 0, 0);
    for (let i = 0; i < SIZE * SIZE; i++) rgb.set([200, 50, 10], i * 3);
    const hole = new Float32Array(SIZE * SIZE);
    for (let y = 24; y < 40; y++) for (let x = 24; x < 40; x++) { hole[y * SIZE + x] = 1; rgb.set([255, 255, 255], (y * SIZE + x) * 3); }
    const out = inpaintBlur(rgb, hole, SIZE);
    const px = (x: number, y: number) => [...out.subarray((y * SIZE + x) * 3, (y * SIZE + x) * 3 + 3)];
    expect(px(32, 32)).toEqual([200, 50, 10]);
    expect(px(5, 5)).toEqual([200, 50, 10]);
  });
});

describe("PGM", () => {
  it("ghi rồi đọc lại đúng; sai kích thước/định dạng thì null", () => {
    const g = Uint8Array.from({ length: 16 }, (_, i) => i * 10);
    expect([...parsePgm(toPgm(g, 4), 4)!]).toEqual([...g]);
    expect(parsePgm(toPgm(g, 4), 5)).toBeNull();
    expect(parsePgm(Buffer.from("junk"), 4)).toBeNull();
  });
  it("PPM có đúng tiêu đề P6", () => {
    expect(toPpm(new Uint8Array(12), 2).subarray(0, 2).toString()).toBe("P6");
  });
});
