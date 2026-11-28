import { describe, expect, it } from "vitest";
import type { ArtImage } from "./scene-art";
import {
  countHistoryBacklog, hasRequiredCredits, HISTORY_BUFFER, parseChapterRef, pickHistoryVideoToFinish, pickHistoryVideoToRebuild, pickReadyScript, recoverOverflowCredits, type HistoryQueueRow,
} from "./history-script";

const art = (o: Partial<ArtImage> = {}): ArtImage => ({ file: "a.jpg", title: "File:A.jpg", url: "u", license: "Public domain", artist: "X", synthetic: false, ...o });

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

describe("đủ ghi công để đăng không — kiểm thẳng bản ghi historyCredits (images+music), không chỉ suy từ nhạc", () => {
  it("null (không tìm được bản ghi — resume thiếu dữ liệu, hoặc video dựng tay từ trước khi có trường này) → KHÔNG đủ, không được đăng", () => {
    expect(hasRequiredCredits(null)).toBe(false);
  });

  it("có nhạc đã dùng → đủ ghi công", () => {
    expect(hasRequiredCredits({ images: [], musicFiles: ["pipeline/music/Rites.mp3"] })).toBe(true);
  });

  it("có ảnh thật dù không có nhạc (bản ghi vẫn có thật — kiểm thẳng cả 2 trường, không chỉ nhạc) → đủ ghi công", () => {
    expect(hasRequiredCredits({ images: [art()], musicFiles: [] })).toBe(true);
  });

  it("bản ghi có thật nhưng cả ảnh và nhạc đều rỗng (video toàn cảnh bản đồ/thẻ chữ) → KHÔNG đủ (không phân biệt được với mất dữ liệu)", () => {
    expect(hasRequiredCredits({ images: [], musicFiles: [] })).toBe(false);
  });
});

describe("khôi phục ảnh ghi công chưa nằm trong mô tả (meta cũ chưa có trường overflowCredits)", () => {
  it("ảnh có tên file đã xuất hiện trong mô tả → không tính là ảnh dư", () => {
    const images = [art({ title: "File:Trong.jpg" })];
    expect(recoverOverflowCredits("Mô tả có nhắc File:Trong.jpg ở đây.", images)).toEqual([]);
  });

  it("ảnh chưa xuất hiện trong mô tả → tính là ảnh dư, đủ tên/tác giả/giấy phép/đường dẫn", () => {
    const images = [art({ title: "File:Ngoai.jpg" })];
    const got = recoverOverflowCredits("Mô tả không nhắc ảnh nào.", images);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatch(/File:Ngoai\.jpg/);
    expect(got[0]).toMatch(/Public domain/);
  });

  it("ảnh AI (synthetic) không bao giờ tính là ảnh dư — không có gì để ghi công", () => {
    const images = [art({ title: "File:AiVe.jpg", synthetic: true })];
    expect(recoverOverflowCredits("Mô tả không nhắc gì.", images)).toEqual([]);
  });

  it("ảnh trùng (storyboard dùng lại) chỉ tính dư một lần", () => {
    const images = [art({ title: "File:Trung.jpg" }), art({ title: "File:Trung.jpg" })];
    expect(recoverOverflowCredits("Không nhắc.", images)).toHaveLength(1);
  });
});

describe("pickReadyScript — kịch bản đã soát đạt chưa có video thì xếp hàng trước khi viết mới", () => {
  const ch = (o: Partial<{ id: number; status: string; content: string; factIssues: unknown }>) => ({ id: 1, status: "draft", content: "kịch bản", factIssues: null, ...o });

  it("draft, hết lỗi sự thật, có nội dung, chưa có video → chọn", () => {
    expect(pickReadyScript([ch({})], new Set())?.id).toBe(1);
  });

  it("còn lỗi sự thật / chưa viết / đã có video / đã duyệt → không chọn", () => {
    expect(pickReadyScript([ch({ factIssues: [{ quote: "x" }] })], new Set())).toBeUndefined();
    expect(pickReadyScript([ch({ status: "outline", content: "" })], new Set())).toBeUndefined();
    expect(pickReadyScript([ch({})], new Set([1]))).toBeUndefined();
    expect(pickReadyScript([ch({ status: "approved" })], new Set())).toBeUndefined();
  });
});

describe("parseChapterRef — factcheck: nhận id chương hoặc <bộ>/<số đề tài>", () => {
  it("id chương", () => expect(parseChapterRef("123")).toEqual({ chapterId: 123 }));
  it("bộ/số", () => expect(parseChapterRef("2/1")).toEqual({ seriesId: 2, number: 1 }));
  it("sai dạng → null", () => expect(parseChapterRef("abc")).toBeNull());
});
