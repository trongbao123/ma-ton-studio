import { describe, expect, it } from "vitest";
import { emptyProgress, mergeProgress, parseProgressEvent, PROGRESS_KEEP, progressKey, progressLine } from "./i2v-progress";

const ev = (p: Record<string, unknown>) => parseProgressEvent({ slug: "mts-i2v-run-0-abc", videoId: 0, total: 2, ...p })!;

describe("parseProgressEvent", () => {
  it("nhận sự kiện hợp lệ từ kernel", () => {
    const e = ev({ clip: 0, step: 23, steps: 50, stage: "clip" });
    expect(e).toMatchObject({ slug: "mts-i2v-run-0-abc", clip: 0, step: 23, steps: 50, stage: "clip" });
  });
  it("bỏ rác: thiếu slug, slug sai dạng, stage lạ", () => {
    expect(parseProgressEvent({ videoId: 0, total: 1, stage: "clip" })).toBeNull();
    expect(parseProgressEvent({ slug: "../../etc", videoId: 0, total: 1, stage: "clip" })).toBeNull();
    expect(parseProgressEvent({ slug: "mts-i2v-run-0-abc", videoId: 0, total: 1, stage: "nhảm" })).toBeNull();
  });
  it("không tin số kernel gửi lên: bước âm hoặc quá lớn thì bỏ", () => {
    expect(parseProgressEvent({ slug: "mts-i2v-run-0-abc", videoId: 0, total: 1, stage: "clip", step: -5 })).toBeNull();
    expect(parseProgressEvent({ slug: "mts-i2v-run-0-abc", videoId: 0, total: 1, stage: "clip", step: 10 ** 9 })).toBeNull();
  });
});

describe("mergeProgress", () => {
  it("sự kiện đầu dựng nên trạng thái", () => {
    const s = mergeProgress(null, ev({ clip: 0, step: 5, steps: 50, stage: "clip" }));
    expect(s.total).toBe(2);
    expect(s.clips[0]).toMatchObject({ step: 5, steps: 50 });
  });
  it("bước sau ghi đè bước trước của CÙNG clip, không đẻ thêm dòng", () => {
    let s = mergeProgress(null, ev({ clip: 0, step: 5, steps: 50, stage: "clip" }));
    s = mergeProgress(s, ev({ clip: 0, step: 40, steps: 50, stage: "clip" }));
    expect(Object.keys(s.clips)).toHaveLength(1);
    expect(s.clips[0].step).toBe(40);
  });
  it("clip khác nhau giữ riêng", () => {
    let s = mergeProgress(null, ev({ clip: 0, stage: "done", seconds: 41 }));
    s = mergeProgress(s, ev({ clip: 1, step: 3, steps: 50, stage: "clip" }));
    expect(Object.keys(s.clips)).toHaveLength(2);
    expect(s.clips[0].done).toBe(true);
  });
  it("giữ VRAM đỉnh CAO NHẤT từng thấy, không để số sau đè số cao hơn", () => {
    let s = mergeProgress(null, ev({ clip: 0, stage: "clip", vram: 13.4 }));
    s = mergeProgress(s, ev({ clip: 0, stage: "clip", vram: 9.1 }));
    expect(s.vramPeak).toBe(13.4);
  });
  it("gói log lại, không phình vô hạn", () => {
    let s = emptyProgress("mts-i2v-run-0-abc", 0, 2);
    for (let i = 0; i < PROGRESS_KEEP + 20; i++) s = mergeProgress(s, ev({ clip: 0, stage: "clip", message: `d${i}` }));
    expect(s.log.length).toBeLessThanOrEqual(PROGRESS_KEEP);
    expect(s.log.at(-1)).toContain(`d${PROGRESS_KEEP + 19}`);
  });
  it("sự kiện của phiên khác bị bỏ — không trộn 2 kernel vào nhau", () => {
    const s = mergeProgress(emptyProgress("mts-i2v-run-0-abc", 0, 2), { ...ev({ clip: 0, stage: "clip" }), slug: "mts-i2v-run-9-zzz" });
    expect(s.clips[0]).toBeUndefined();
  });
});

describe("progressLine", () => {
  it("đọc được bằng mắt: clip thứ mấy, bước thứ mấy, VRAM", () => {
    let s = mergeProgress(null, ev({ clip: 0, stage: "done", seconds: 41 }));
    s = mergeProgress(s, ev({ clip: 1, step: 23, steps: 50, stage: "clip", vram: 11.2 }));
    const line = progressLine(s);
    expect(line).toContain("1/2");
    expect(line).toContain("23/50");
    expect(line).toContain("11.2");
  });
  it("chưa có gì thì nói chưa có, không in NaN", () => {
    expect(progressLine(emptyProgress("mts-i2v-run-0-abc", 0, 2))).not.toMatch(/NaN|undefined/);
  });
});

describe("progressKey", () => {
  it("mỗi phiên một khoá riêng trong app_settings", () => {
    expect(progressKey("mts-i2v-run-0-abc")).toBe("i2v:progress:mts-i2v-run-0-abc");
    expect(progressKey("a")).not.toBe(progressKey("b"));
  });
});
