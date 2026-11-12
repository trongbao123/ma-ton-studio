import { describe, expect, it } from "vitest";
import { isDue, mergeStats, parseAnalytics, parseCtr, STATS_EVERY_MS } from "./vidiq-stats";

describe("đọc số liệu vidIQ", () => {
  it("parseCtr: lượt hiển thị + CTR từng video (đọc qua extension Studio)", () => {
    const text = JSON.stringify({
      status: "completed",
      result: { videos: [{ videoId: "lyh4iPDZscM", availability: "available", thumbnailImpressions: 4369, thumbnailCtrPercentage: 0.89 }, { videoId: "x", availability: "unavailable", thumbnailImpressions: null, thumbnailCtrPercentage: null }] },
    });
    expect(parseCtr(text)).toEqual({ job: null, rows: { lyh4iPDZscM: { impressions: 4369, ctr: 0.89 } } });
  });
  it("parseCtr: trình duyệt chưa mở → giữ jobId để lượt sau đọc tiếp", () => {
    expect(parseCtr(JSON.stringify({ status: "waiting_for_browser", jobId: "xj_1" }))).toEqual({ job: "xj_1", rows: {} });
  });
  it("parseCtr: chữ không phải JSON → không có số, không ném lỗi, ghi lý do", () => {
    expect(parseCtr("lỗi gì đó")).toEqual({ job: null, rows: {}, error: "lỗi gì đó" });
  });
  it("parseAnalytics: theo cột tên, không theo vị trí", () => {
    const text = JSON.stringify({
      columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }],
      rows: [["lyh4iPDZscM", 56, 86, 8.87]],
    });
    expect(parseAnalytics(text)).toEqual({ lyh4iPDZscM: { views: 56, avgViewSec: 86, avgViewPct: 8.87 } });
  });
});

describe("lịch lấy số", () => {
  it("chưa lấy bao giờ hoặc quá hạn thì lấy", () => {
    expect(isDue(null, 1000)).toBe(true);
    expect(isDue(0, STATS_EVERY_MS)).toBe(true);
    expect(isDue(1, STATS_EVERY_MS)).toBe(false);
  });
  it("mergeStats gộp CTR + analytics theo id, giữ số cũ của video không có trong lượt mới", () => {
    const old = { a: { views: 1 }, b: { views: 2, ctr: 1 } };
    expect(mergeStats(old, { b: { impressions: 10, ctr: 3 } }, { b: { views: 5, avgViewSec: 9, avgViewPct: 4 } })).toEqual({
      a: { views: 1 },
      b: { views: 5, ctr: 3, impressions: 10, avgViewSec: 9, avgViewPct: 4 },
    });
  });
});

describe("vidIQ không trả số CTR", () => {
  it("ghi lại lý do (vd extension chưa kết nối) thay vì im lặng", () => {
    const r = parseCtr(JSON.stringify({ status: "failed", errorCode: "extension_not_connected", message: "Connect the vidIQ extension" }));
    expect(r.rows).toEqual({});
    expect(r.error).toBe("extension_not_connected: Connect the vidIQ extension");
  });
  it("chữ không phải JSON thì lý do là chính đoạn chữ đó", () => {
    expect(parseCtr("Tool not available").error).toBe("Tool not available");
  });
});

describe("thử lại CTR", () => {
  it("CTR chưa đọc được (trình duyệt tắt) thì lượt cron sau thử lại, không chờ 3 ngày", async () => {
    const { nextPending, RETRY } = await import("./vidiq-stats");
    expect(nextPending({ job: null, rows: {}, error: "extension_not_connected" })).toBe(RETRY);
    expect(nextPending({ job: "xj_1", rows: {} })).toBe("xj_1");
    expect(nextPending({ job: null, rows: { a: { ctr: 1 } } })).toBeNull();
  });
  it("ctrArgs: thử lại thì gửi báo cáo mới, còn job thì đọc tiếp job", async () => {
    const { ctrArgs, RETRY } = await import("./vidiq-stats");
    expect(ctrArgs("xj_1", ["a"], 0)).toEqual({ jobId: "xj_1" });
    expect(ctrArgs(RETRY, ["a"], 0)).toMatchObject({ report: "thumbnail_ctr", videoIds: ["a"] });
    expect(ctrArgs(null, ["a"], 0)).toMatchObject({ report: "thumbnail_ctr" });
  });
});
