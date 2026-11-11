import { describe, expect, it } from "vitest";
import { kaggleWeekStartDay, nextKaggleReset, parseKaggleQuota } from "./kaggle-quota";

describe("parseKaggleQuota", () => {
  it("đọc đúng trả lời thật của Kaggle (30 giờ = 108000 giây)", () => {
    const q = parseKaggleQuota({
      quotaRefreshTime: "2026-11-14T00:00:00Z",
      gpuQuota: { timeUsed: { seconds: 3600 }, totalTimeAllowed: { seconds: 108000 }, hasEverRun: true },
    });
    expect(q).toEqual({ usedSeconds: 3600, totalSeconds: 108000, refreshAt: "2026-11-14T00:00:00Z", hasEverRun: true });
  });
  it("thiếu tổng hoặc mốc reset thì null", () => {
    expect(parseKaggleQuota({})).toBeNull();
    expect(parseKaggleQuota({ quotaRefreshTime: "x", gpuQuota: { timeUsed: { seconds: 1 } } })).toBeNull();
  });
});

describe("nextKaggleReset", () => {
  it("thứ Tư 11/11/2026 → 00:00 UTC thứ Bảy 14/11", () => {
    expect(nextKaggleReset(new Date("2026-11-11T09:00:00Z")).toISOString()).toBe("2026-11-14T00:00:00.000Z");
  });
  it("đúng thứ Bảy thì sang thứ Bảy tuần sau", () => {
    expect(nextKaggleReset(new Date("2026-11-14T10:00:00Z")).toISOString()).toBe("2026-11-21T00:00:00.000Z");
  });
  it("tuần quota bắt đầu 7 ngày trước mốc reset", () => {
    expect(kaggleWeekStartDay(new Date("2026-11-14T00:00:00Z"))).toBe("2026-11-07");
  });
});
