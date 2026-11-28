import { describe, expect, it } from "vitest";
import { countHistoryBacklog, HISTORY_BUFFER, pickHistoryVideoToFinish, pickHistoryVideoToRebuild, type HistoryQueueRow } from "./history-script";

const row = (o: Partial<HistoryQueueRow>): HistoryQueueRow => ({ id: 1, status: "queued", youtubeVideoId: null, publishAt: null, meta: null, ...o });

describe("chọn video lịch sử để dựng lại (historyAuto) — CHỈ queued", () => {
  it("có video queued chưa lên YouTube → dựng lại video cũ nhất", () => {
    expect(pickHistoryVideoToRebuild([row({ id: 3 }), row({ id: 1 }), row({ id: 2 })])).toBe(1);
  });

  it("video failed (TRƯỢT QC, không phải lỗi hạ tầng) → KHÔNG dựng lại tự động — chờ sửa tay rồi Soát lại", () => {
    expect(pickHistoryVideoToRebuild([row({ id: 1, status: "failed" })])).toBeUndefined();
  });

  it("video đã lên YouTube rồi thì bỏ qua dù status còn queued (dữ liệu cũ)", () => {
    expect(pickHistoryVideoToRebuild([row({ id: 1, status: "queued", youtubeVideoId: "abc" })])).toBeUndefined();
  });

  it("video đang rendering hoặc đã ready/published → không phải việc cần dựng lại", () => {
    expect(pickHistoryVideoToRebuild([row({ status: "rendering" })])).toBeUndefined();
    expect(pickHistoryVideoToRebuild([row({ status: "ready" })])).toBeUndefined();
    expect(pickHistoryVideoToRebuild([row({ status: "published" })])).toBeUndefined();
  });

  it("không có video nào → undefined", () => {
    expect(pickHistoryVideoToRebuild([])).toBeUndefined();
  });
});

describe("chọn video lịch sử để hoàn tất (meta/thumbnail/đăng) — ưu tiên cao nhất", () => {
  it("video ready chưa có youtubeVideoId → hoàn tất, cũ nhất trước", () => {
    expect(pickHistoryVideoToFinish([row({ id: 5, status: "ready" }), row({ id: 2, status: "ready" })])).toBe(2);
  });

  it("video ready nhưng đã có youtubeVideoId (lỗi đồng bộ) → không chọn lại", () => {
    expect(pickHistoryVideoToFinish([row({ status: "ready", youtubeVideoId: "x" })])).toBeUndefined();
  });

  it("không có video ready nào → undefined", () => {
    expect(pickHistoryVideoToFinish([row({ status: "queued" }), row({ status: "rendering" })])).toBeUndefined();
  });
});

describe("đếm kho video lịch sử (mọi trạng thái chưa phát xong, KHÔNG riêng 'ready')", () => {
  const now = new Date("2026-11-28T12:00:00Z");

  it("queued/rendering/ready đều tính vào kho — không chỉ 'ready'", () => {
    expect(countHistoryBacklog([row({ status: "queued" }), row({ status: "rendering" }), row({ status: "ready" })], now)).toBe(3);
  });

  it("video failed (trượt QC) không tính vào kho — chờ sửa tay", () => {
    expect(countHistoryBacklog([row({ status: "failed" })], now)).toBe(0);
  });

  it("video đã publishAt qua rồi (đã phát xong) không tính vào kho", () => {
    expect(countHistoryBacklog([row({ status: "published", publishAt: new Date("2026-11-20T00:00:00Z") })], now)).toBe(0);
  });

  it("video có publishAt trong tương lai (đã lên lịch, chưa phát) vẫn tính vào kho", () => {
    expect(countHistoryBacklog([row({ status: "published", publishAt: new Date("2026-12-01T00:00:00Z") })], now)).toBe(1);
  });

  it("bản gộp (meta.compilation) không tính vào kho lịch sử", () => {
    expect(countHistoryBacklog([row({ status: "ready", meta: { compilation: { seriesId: 1, from: 1, to: 2, videoIds: [1, 2] } } as never })], now)).toBe(0);
  });

  it("HISTORY_BUFFER là ngưỡng dương nhỏ (không tích kho lớn — mỗi lượt dựng tới 4,5 giờ)", () => {
    expect(HISTORY_BUFFER).toBeGreaterThan(0);
    expect(HISTORY_BUFFER).toBeLessThanOrEqual(3);
  });
});
