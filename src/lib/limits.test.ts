import { describe, expect, it } from "vitest";
import { cfNeuronsOf, geminiDailyLimit, levelOf, percentUsed, ytUnitsOf } from "./limits";

describe("percentUsed", () => {
  it("làm tròn và chặn 0–100", () => {
    expect(percentUsed(1, 3)).toBe(33);
    expect(percentUsed(12_000, 10_000)).toBe(100);
  });
  it("thiếu số hoặc tổng ≤ 0 → null", () => {
    expect(percentUsed(null, 10)).toBeNull();
    expect(percentUsed(5, null)).toBeNull();
    expect(percentUsed(5, 0)).toBeNull();
  });
});

describe("levelOf", () => {
  it.each([
    [null, "ok"],
    [0, "ok"],
    [59, "ok"],
    [60, "warn"],
    [84, "warn"],
    [85, "danger"],
    [100, "danger"],
  ] as const)("%s%% → %s", (p, level) => expect(levelOf(p)).toBe(level));
});

describe("ytUnitsOf", () => {
  it("cộng theo bảng quota YouTube", () => {
    expect(ytUnitsOf({ videoUpload: 1 })).toBe(1600);
    expect(ytUnitsOf({ videoUpload: 2, thumbnailSet: 2, playlistItemInsert: 2, videoUpdate: 1, videosList: 3 })).toBe(3200 + 100 + 100 + 50 + 3);
    expect(ytUnitsOf({})).toBe(0);
  });
});

describe("ước tính Cloudflare / mốc Gemini", () => {
  it("neuron theo số ảnh", () => {
    expect(cfNeuronsOf(0)).toBe(0);
    expect(cfNeuronsOf(10)).toBe(593);
  });
  it("mốc theo họ model", () => {
    expect(geminiDailyLimit("gemini-3.8-flash")).toBe(20);
    expect(geminiDailyLimit("gemini-3.8-flash-tts")).toBe(10);
    expect(geminiDailyLimit("gemma-4-31b-it")).toBeNull();
  });
});
