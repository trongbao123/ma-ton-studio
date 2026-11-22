import { describe, expect, it, vi } from "vitest";
import type { Shot } from "@/lib/story/storyboard";
import { renderTerrainScene, stopAfterFailure, TERRAIN_MAX_SECONDS_PER_VIDEO, terrainBudget, type TerrainRun } from "./scene-terrain";

const places = new Map([
  ["Tam Điệp, Ninh Bình", { lat: 20.15, lon: 105.9 }],
  ["Thăng Long, Hà Nội", { lat: 21.03, lon: 105.84 }],
]);
const shot: Shot = { kind: "terrain", from: 0, to: 2, start: 0, end: 9, camera: "pan", sfx: [], places: [...places.keys()], route: [...places.keys()] };
const scene = (over: Partial<TerrainRun> = {}): TerrainRun => ({ shot, places, dir: ".render/test", out: ".render/test/t.mp4", budget: terrainBudget(), runOnKaggle: async () => {}, ...over });

describe("ngân sách địa hình 3D", () => {
  it("cộng dồn tới trần rồi hết chỗ", () => {
    const budget = terrainBudget();
    expect(budget.take(TERRAIN_MAX_SECONDS_PER_VIDEO - 1)).toBe(true);
    expect(budget.take(5)).toBe(false);
  });
});

describe("dựng cảnh địa hình 3D", () => {
  it("Kaggle lỗi → trả false, không ném (cảnh lùi về bản đồ 2D)", async () => {
    const runOnKaggle = vi.fn(async () => {
      throw new Error("Kaggle hết giờ GPU");
    });
    expect(await renderTerrainScene(scene({ runOnKaggle }))).toBe(false);
  });

  it("hết ngân sách 3D → trả false ngay, không gọi Kaggle", async () => {
    const budget = terrainBudget();
    budget.take(TERRAIN_MAX_SECONDS_PER_VIDEO);
    const runOnKaggle = vi.fn(async () => {});
    expect(await renderTerrainScene(scene({ budget, runOnKaggle }))).toBe(false);
    expect(runOnKaggle).not.toHaveBeenCalled();
  });

  it("không có địa danh nào tra được → trả false, không gọi Kaggle", async () => {
    const runOnKaggle = vi.fn(async () => {});
    expect(await renderTerrainScene(scene({ places: new Map(), runOnKaggle }))).toBe(false);
    expect(runOnKaggle).not.toHaveBeenCalled();
  });
});

describe("gửi việc 3D sang Kaggle", () => {
  it("chưa cấu hình Kaggle → ném lỗi rõ ràng (bên gọi lùi về bản đồ 2D)", async () => {
    const saved = process.env.KAGGLE_API_TOKEN;
    delete process.env.KAGGLE_API_TOKEN;
    const { kaggleTerrainJob } = await import("./scene-terrain");
    await expect(kaggleTerrainJob({ videoId: 1, log: () => {} })({ dir: ".render/x", framesDir: ".render/x/frames", shot })).rejects.toThrow(/Kaggle/i);
    if (saved) process.env.KAGGLE_API_TOKEN = saved;
  });
});

describe("cầu dao Kaggle", () => {
  it("hỏng một lần là mọi lượt sau trượt NGAY, không gọi Kaggle lại", async () => {
    const kaggle = vi.fn(async () => {
      throw new Error("Kernel 3D quá 20 phút");
    });
    const stopped: string[] = [];
    const job = stopAfterFailure(kaggle, (reason) => stopped.push(reason));
    await expect(job({ dir: "d", framesDir: "f", shot })).rejects.toThrow("quá 20 phút");
    await expect(job({ dir: "d", framesDir: "f", shot })).rejects.toThrow(/tắt cảnh 3D/i);
    await expect(job({ dir: "d", framesDir: "f", shot })).rejects.toThrow(/tắt cảnh 3D/i);
    expect(kaggle).toHaveBeenCalledTimes(1);
    expect(stopped).toHaveLength(1);
  });

  it("chạy trơn thì không chặn lượt nào", async () => {
    const kaggle = vi.fn(async () => {});
    const job = stopAfterFailure(kaggle);
    await job({ dir: "d", framesDir: "f", shot });
    await job({ dir: "d", framesDir: "f", shot });
    expect(kaggle).toHaveBeenCalledTimes(2);
  });
});
