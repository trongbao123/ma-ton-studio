import { describe, expect, it } from "vitest";
import { LIFE_PART_WORDS, LIFE_TARGET_WORDS, lifeContinueTask, lifeIsFinalPart } from "./life";

describe("truyện chuyện đời ~1 tiếng", () => {
  it("mục tiêu đủ 1 tiếng ở ~177 từ/phút", () => expect(LIFE_TARGET_WORDS / 177).toBeGreaterThan(60));

  it("các lượt giữa chưa kết, lượt kết khi phần còn thiếu vừa một lượt", () => {
    expect(lifeIsFinalPart(3000)).toBe(false);
    expect(lifeIsFinalPart(6000)).toBe(false);
    expect(lifeIsFinalPart(9000)).toBe(true);
  });

  it("lượt kết luôn đủ dài: truyện tối thiểu vẫn ≥ 1 tiếng", () => {
    // Lượt kết sớm nhất bắt đầu khi còn thiếu LIFE_PART_WORDS × 1,4; lượt kết viết tối thiểu LIFE_PART_WORDS.
    const earliestFinal = LIFE_TARGET_WORDS - LIFE_PART_WORDS * 1.4;
    expect(lifeIsFinalPart(Math.ceil(earliestFinal))).toBe(true);
    expect((earliestFinal + LIFE_PART_WORDS) / 177).toBeGreaterThan(60);
  });

  it("lượt giữa dặn chưa kết; lượt cuối dặn kết trọn vẹn", () => {
    expect(lifeContinueTask(3000)).toContain("CHƯA kết truyện");
    expect(lifeContinueTask(9000)).toContain("kết trọn vẹn");
    expect(lifeContinueTask(11500)).toContain(`khoảng ${LIFE_PART_WORDS} từ`);
  });
});
