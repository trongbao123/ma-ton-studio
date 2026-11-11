import { describe, expect, it } from "vitest";
import { i2vSubtitle, kaggleNow, type VideoProgress } from "./progress";

describe("kaggleNow", () => {
  const base: VideoProgress = {
    steps: { i2v: { state: "run", log: [], long: { done: 0, total: 6 } } },
    i2v: { stage: "running", clips: [{ scene: 0, motion: "a", ok: true }, { scene: 3, motion: "b", ok: true }, { scene: 5, motion: "c" }] },
  };
  it("đang chạy: đếm clip đã xong theo log, tổng theo bước", () => {
    expect(kaggleNow(base)).toEqual({ done: 2, total: 6, stage: "running" });
  });
  it("không chạy hoặc chưa có bước thì null", () => {
    expect(kaggleNow({ ...base, steps: { i2v: { state: "done", log: [] } } })).toBeNull();
    expect(kaggleNow({ steps: {} })).toBeNull();
    expect(kaggleNow(null)).toBeNull();
  });
});

describe("i2vSubtitle", () => {
  it("chữ theo giai đoạn", () => {
    expect(i2vSubtitle("run", "queued", 0, 6)).toBe("chờ GPU Kaggle");
    expect(i2vSubtitle("run", "download", 6, 6)).toBe("đang tải clip về");
    expect(i2vSubtitle("error", "running", 0, 6)).toBe("lỗi → dùng ảnh tĩnh");
  });
});
