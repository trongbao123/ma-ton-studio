import { describe, expect, it } from "vitest";
import {
  CANVAS_SCALE, LAYER_WEIGHTS, PARALLAX_MOTIONS, canvasChain, easeAt, layerExpr, panRoomPx, parallaxFilterGraph, parallaxInputArgs, parallaxMotionFor, planParallax, spreadOrder,
  type ParallaxFiles,
} from "./parallax-plan";

const files: ParallaxFiles = { farFill: "a.ppm", farPatch: "b.pgm", midFill: "c.ppm", midPatch: "d.pgm", midAlpha: "e.pgm", nearAlpha: "f.pgm" };

describe("parallaxMotionFor", () => {
  it("xoay vòng dolly-in → trượt phải → nâng lên → trượt trái, ảnh đầu là dolly-in", () => {
    expect([0, 1, 2, 3, 4, 5].map(parallaxMotionFor)).toEqual(["dollyIn", "truckRight", "craneUp", "truckLeft", "dollyIn", "truckRight"]);
    expect(parallaxMotionFor(-1)).toBe("truckLeft");
  });
});

describe("easeAt", () => {
  it("chậm–nhanh–chậm: 0 ở đầu, 1 ở cuối, 0,5 ở giữa, đứng yên sau motionFrames", () => {
    expect(easeAt(0, 100)).toBe(0);
    expect(easeAt(50, 100)).toBeCloseTo(0.5);
    expect(easeAt(100, 100)).toBeCloseTo(1);
    expect(easeAt(900, 100)).toBeCloseTo(1);
  });
  it("vận tốc bằng 0 ở hai đầu (không giật khi bắt đầu/kết thúc)", () => {
    expect(easeAt(1, 144) - easeAt(0, 144)).toBeLessThan(0.0006);
    expect(easeAt(144, 144) - easeAt(143, 144)).toBeLessThan(0.0006);
  });
});

describe("layerExpr", () => {
  const args = { motion: "truckLeft" as const, w: 1920, h: 1080, motionFrames: 144 };
  it("lớp gần dịch nhiều hơn lớp xa theo đúng hệ số", () => {
    const shift = (layer: 0 | 1 | 2) => Number(/-([\d.]+)\*\(0\.5/.exec(layerExpr({ ...args, layer }).x)![1]);
    expect(shift(2) / shift(0)).toBeCloseTo(LAYER_WEIGHTS[2] / LAYER_WEIGHTS[0], 2);
    expect(shift(2)).toBeCloseTo(0.022 * 1920 * CANVAS_SCALE, 1);
  });
  it("dolly-in không dịch ngang/dọc, chỉ zoom lớn dần theo lớp", () => {
    const e = layerExpr({ motion: "dollyIn", layer: 2, w: 1920, h: 1080, motionFrames: 144 });
    expect(e.x).toContain("-0*");
    expect(e.z.startsWith("1+0.07*")).toBe(true);
  });
  it("easing kẹp ở motionFrames (giữ khung cuối)", () => {
    expect(layerExpr({ ...args, layer: 1 }).z).toContain("min(on,144)");
  });
});

describe("panRoomPx", () => {
  it.each(PARALLAX_MOTIONS)("%s: lớp gần không bao giờ lộ mép canvas (ngang và dọc, khung ngang và dọc)", (motion) => {
    for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
      const room = panRoomPx(motion, w, h);
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parallaxFilterGraph", () => {
  const graph = parallaxFilterGraph({ w: 1920, h: 1080, frames: 144, motionFrames: 144, fps: 24, motion: "truckRight", logoCrop: "crop=iw:ih*0.93:0:0," });
  it("3 zoompan (mỗi lớp 1), canvas 2×, cắt logo trước khi scale, ra nhãn [v]", () => {
    expect(graph.match(/zoompan=/g)).toHaveLength(3);
    expect(graph).toContain("[0:v]crop=iw:ih*0.93:0:0,scale=3840:2160:force_original_aspect_ratio=increase");
    expect(graph).toContain("d=144:s=1920x1080:fps=24");
    expect(graph.endsWith("[v]")).toBe(true);
  });
  it("dùng đủ 6 đầu vào phụ và chồng lớp xa → giữa → gần", () => {
    for (let i = 1; i <= 6; i++) expect(graph).toContain(`[${i}:v]`);
    expect(graph.indexOf("[z0][z1]overlay")).toBeLessThan(graph.indexOf("[o1][z2]overlay"));
  });
  it("đoạn dài hơn chuyển động thì giữ khung cuối bằng tpad, không thì không có tpad", () => {
    const held = parallaxFilterGraph({ w: 1920, h: 1080, frames: 720, motionFrames: 192, fps: 24, motion: "dollyIn" });
    expect(held).toContain("d=192:");
    expect(held).toContain("tpad=stop_mode=clone:stop=528");
    expect(graph).not.toContain("tpad");
  });
  it("làm nét chèn vào canvas khi có canvasExtra", () => {
    expect(parallaxFilterGraph({ w: 1080, h: 1920, frames: 90, motionFrames: 90, fps: 30, motion: "dollyIn", canvasExtra: "unsharp=5:5:1.0" })).toContain("unsharp=5:5:1.0,format=yuv420p,split=3");
  });
});

describe("canvasChain / parallaxInputArgs", () => {
  it("khung cắt giống chương tĩnh (scale phủ kín, cắt lệch lên 30%)", () => {
    expect(canvasChain(1920, 1080)).toBe("scale=1920:1080:force_original_aspect_ratio=increase:flags=bicubic,crop=1920:1080:(iw-ow)/2:(ih-oh)*0.3");
  });
  it("mỗi file một -i theo thứ tự [1]..[6]", () => {
    expect(parallaxInputArgs(files)).toEqual(["-i", "a.ppm", "-i", "b.pgm", "-i", "c.ppm", "-i", "d.pgm", "-i", "e.pgm", "-i", "f.pgm"]);
  });
});

describe("spreadOrder", () => {
  it("là hoán vị của 0..n-1, đầu danh sách rải đều", () => {
    const o = spreadOrder(10);
    expect([...o].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(o.slice(0, 2)).toEqual([0, 5]);
  });
  it("n = 0 và 1", () => {
    expect(spreadOrder(0)).toEqual([]);
    expect(spreadOrder(1)).toEqual([0]);
  });
});

describe("planParallax", () => {
  const scenes = [
    ...Array.from({ length: 3 }, (_, i) => ({ start: i * 6, end: i * 6 + 6, zoom: true })),
    ...Array.from({ length: 10 }, (_, i) => ({ start: 18 + i * 30, end: 48 + i * 30, action: i === 4 })),
  ];
  it("2 phút đầu luôn đủ cả đoạn, kể cả khi ngân sách phụ bằng 0", () => {
    const plan = planParallax(scenes, { extraSeconds: 0, headSeconds: 8, actionSeconds: 12 });
    expect(plan.slice(0, 3).map((p) => p.seconds)).toEqual([6, 6, 6]);
    expect(plan.slice(3).every((p) => p.seconds === 0)).toBe(true);
  });
  it("cảnh action được ưu tiên và dài hơn; phần còn lại chỉ vài giây đầu", () => {
    const plan = planParallax(scenes, { extraSeconds: 12 + 8 * 2, headSeconds: 8, actionSeconds: 12 });
    expect(plan[3 + 4].seconds).toBe(12);
    expect(plan.slice(3).filter((p) => p.seconds === 8)).toHaveLength(2);
  });
  it("không vượt ngân sách phụ và rải đều (không dồn vào đầu chương)", () => {
    const plan = planParallax(scenes, { extraSeconds: 36, headSeconds: 8, actionSeconds: 12 });
    const rest = plan.slice(3);
    expect(rest.reduce((a, p) => a + p.seconds, 0)).toBeLessThanOrEqual(36);
    const picked = rest.map((p, i) => (p.seconds ? i : -1)).filter((i) => i >= 0);
    expect(picked.some((i) => i >= 5)).toBe(true);
  });
  it("đoạn ngắn hơn headSeconds thì chỉ áp bằng độ dài đoạn", () => {
    const plan = planParallax([{ start: 0, end: 5 }], { extraSeconds: 100, headSeconds: 8, actionSeconds: 12 });
    expect(plan[0].seconds).toBe(5);
  });
});
