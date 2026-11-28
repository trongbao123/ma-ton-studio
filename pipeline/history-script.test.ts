import { describe, expect, it } from "vitest";
import {
  chunkCreditLines, countHistoryBacklog, hasRequiredCredits, HISTORY_BUFFER, pickHistoryVideoToFinish, pickHistoryVideoToRebuild, type HistoryQueueRow,
} from "./history-script";

const row = (o: Partial<HistoryQueueRow>): HistoryQueueRow => ({ id: 1, status: "queued", youtubeVideoId: null, publishAt: null, meta: null, uploadStatus: "none", ...o });

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

  it("video ready nhưng uploadStatus 'failed' (lượt trước đăng lỗi/thiếu ghi công) → không chọn lại, chờ chủ kênh", () => {
    expect(pickHistoryVideoToFinish([row({ status: "ready", uploadStatus: "failed" })])).toBeUndefined();
  });

  it("video ready nhưng uploadStatus 'scheduled' (đã đăng xong, chưa kịp đồng bộ youtubeVideoId) → không chọn lại", () => {
    expect(pickHistoryVideoToFinish([row({ status: "ready", uploadStatus: "scheduled" })])).toBeUndefined();
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

describe("đủ ghi công để đăng không — video lịch sử nào dựng đạt QC cũng luôn có nhạc", () => {
  it("có nhạc đã dùng → đủ ghi công", () => {
    expect(hasRequiredCredits({ images: [], musicFiles: ["pipeline/music/Rites.mp3"] })).toBe(true);
  });

  it("không có nhạc (mất dữ liệu historyCredits, hoặc video dựng tay từ trước) → KHÔNG đủ, không được đăng", () => {
    expect(hasRequiredCredits({ images: [], musicFiles: [] })).toBe(false);
  });

  it("có ảnh nhưng không có nhạc → vẫn KHÔNG đủ (nhạc là tín hiệu duy nhất đáng tin — ảnh có thể hợp lệ là rỗng)", () => {
    expect(hasRequiredCredits({ images: [{ file: "a.jpg", title: "File:A.jpg", url: "u", license: "PD", artist: "X", synthetic: false }], musicFiles: [] })).toBe(false);
  });
});

describe("chia dòng ghi công ảnh thành nhiều bình luận (không bỏ ghi công nào)", () => {
  it("đủ ngắn thì gộp vào một đoạn", () => {
    const chunks = chunkCreditLines(["dòng 1", "dòng 2"], 1000);
    expect(chunks).toEqual([["dòng 1", "dòng 2"]]);
  });

  it("dài hơn ngân sách byte thì chia nhiều đoạn, không mất dòng nào", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `- File:Anh${i}.jpg — Tác giả — CC BY-SA 4.0 — https://commons.wikimedia.org/wiki/File:Anh${i}.jpg`);
    const chunks = chunkCreditLines(lines, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(lines);
    for (const chunk of chunks) expect(Buffer.byteLength(chunk.join("\n"), "utf8")).toBeLessThanOrEqual(300);
  });

  it("danh sách rỗng → không có đoạn nào", () => {
    expect(chunkCreditLines([], 300)).toEqual([]);
  });
});
