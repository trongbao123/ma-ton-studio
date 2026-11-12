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
  it("parseCtr: chữ không phải JSON → rỗng, không ném lỗi", () => {
    expect(parseCtr("lỗi gì đó")).toEqual({ job: null, rows: {} });
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
