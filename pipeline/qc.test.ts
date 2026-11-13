import { describe, expect, it } from "vitest";
import { judgeQc, parseQcLog, QC } from "./qc";

const ok = { seconds: 600, cuts: 140, longestFreeze: 0, freezeAt: null, longestBlack: 0, blackAt: null, lufs: -15 };

describe("judgeQc — ngưỡng theo kênh top", () => {
  it("kiểu mới (14 cắt/phút, không đứng im) đạt", () => {
    expect(judgeQc(ok).ok).toBe(true);
  });
  it("tập 25 thật: 0 cắt, đứng im 57,5s → trượt cả 2 tiêu chí", () => {
    const r = judgeQc({ ...ok, seconds: 75, cuts: 0, longestFreeze: 57.5, freezeAt: 1 });
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/nhịp cắt 0\.0/);
    expect(r.problems.join(" ")).toMatch(/đứng im 57\.5s/);
  });
  it("màn đen dài và âm lượng lệch cũng trượt", () => {
    expect(judgeQc({ ...ok, longestBlack: 1.2, blackAt: 300 }).problems[0]).toMatch(/màn đen/);
    expect(judgeQc({ ...ok, lufs: -25 }).problems[0]).toMatch(/âm lượng/);
  });
  it("ngưỡng: ≥ 10 cắt/phút, đứng im ≤ 8s", () => {
    expect(QC.minCutsPerMin).toBe(10);
    expect(QC.maxFreezeSeconds).toBe(8);
  });
});

describe("parseQcLog", () => {
  it("đọc tuần tự: freeze_start không kèm duration không làm lệch các đoạn sau", () => {
    const v = [
      "freeze_start: 431.6", "freeze_duration: 6.7",
      "freeze_start: 446.6",
      "freeze_start: 467.4", "freeze_duration: 9.4",
      "freeze_start: 579.5", "freeze_duration: 22.2",
      "pts_time:1.0", "pts_time:5.0",
      "black_start:0.02 black_end:0.14 black_duration:0.12",
      "black_start:58.4 black_end:58.6 black_duration:0.2",
    ].join("\n");
    const m = parseQcLog(v, "    I:         -15.9 LUFS", 600);
    expect(m.cuts).toBe(2);
    expect(m.longestFreeze).toBeCloseTo(22.2);
    expect(m.freezeAt).toBeCloseTo(579.5);
    expect(m.longestBlack).toBeCloseTo(0.2);
    expect(m.lufs).toBe(-15.9);
  });
  it("đoạn đứng im chưa kết thúc tới hết cửa sổ thì tính tới cuối cửa sổ", () => {
    const m = parseQcLog("freeze_start: 1.0", "", 75);
    expect(m.longestFreeze).toBe(74);
  });
});
