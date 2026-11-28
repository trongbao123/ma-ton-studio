import { describe, expect, it } from "vitest";
import { pickHistoryVideoToRebuild, type HistoryRebuildCandidate } from "./history-script";

const video = (o: Partial<HistoryRebuildCandidate>): HistoryRebuildCandidate => ({ id: 1, status: "queued", youtubeVideoId: null, ...o });

describe("chọn video lịch sử để dựng lại (historyAuto)", () => {
  it("có video queued chưa lên YouTube → dựng lại video cũ nhất", () => {
    const got = pickHistoryVideoToRebuild([video({ id: 3, status: "queued" }), video({ id: 1, status: "queued" }), video({ id: 2, status: "failed" })]);
    expect(got?.id).toBe(1);
  });

  it("video failed (lỗi hạ tầng) chưa lên YouTube → vẫn tính là dựng lại được", () => {
    const got = pickHistoryVideoToRebuild([video({ id: 1, status: "failed" })]);
    expect(got?.id).toBe(1);
  });

  it("video đã lên YouTube rồi thì bỏ qua dù status còn queued/failed (dữ liệu cũ)", () => {
    const got = pickHistoryVideoToRebuild([video({ id: 1, status: "failed", youtubeVideoId: "abc" })]);
    expect(got).toBeUndefined();
  });

  it("video đang rendering hoặc đã ready/published → không phải việc cần dựng lại", () => {
    expect(pickHistoryVideoToRebuild([video({ status: "rendering" })])).toBeUndefined();
    expect(pickHistoryVideoToRebuild([video({ status: "ready" })])).toBeUndefined();
    expect(pickHistoryVideoToRebuild([video({ status: "published" })])).toBeUndefined();
  });

  it("không có video nào → undefined (historyAuto viết đề tài mới)", () => {
    expect(pickHistoryVideoToRebuild([])).toBeUndefined();
  });
});
