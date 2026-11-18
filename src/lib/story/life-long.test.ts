import { describe, expect, it } from "vitest";
import { LIFE_OPENINGS, LIFE_PART_WORDS, LIFE_TARGET_WORDS, lifeContinueTask, lifeEnding, lifeIsFinalPart, lifeOpening } from "./life";

describe("truyện chuyện đời ~1 tiếng", () => {
  it("mục tiêu ~1 tiếng 30 ở ~177 từ/phút", () => expect(LIFE_TARGET_WORDS / 177).toBeGreaterThan(90));

  it("các lượt giữa chưa kết, lượt kết khi phần còn thiếu vừa một lượt", () => {
    expect(lifeIsFinalPart(3000)).toBe(false);
    expect(lifeIsFinalPart(6000)).toBe(false);
    expect(lifeIsFinalPart(LIFE_TARGET_WORDS - LIFE_PART_WORDS)).toBe(true);
  });

  it("lượt kết luôn đủ dài: truyện tối thiểu vẫn ≥ 85 phút", () => {
    // Lượt kết sớm nhất bắt đầu khi còn thiếu LIFE_PART_WORDS × 1,4; lượt kết viết tối thiểu LIFE_PART_WORDS.
    const earliestFinal = LIFE_TARGET_WORDS - LIFE_PART_WORDS * 1.4;
    expect(lifeIsFinalPart(Math.ceil(earliestFinal))).toBe(true);
    expect((earliestFinal + LIFE_PART_WORDS) / 177).toBeGreaterThan(85);
  });

  it("lượt giữa dặn chưa kết; lượt cuối dặn kết trọn vẹn", () => {
    expect(lifeContinueTask(3000)).toContain("CHƯA kết truyện");
    expect(lifeContinueTask(LIFE_TARGET_WORDS - LIFE_PART_WORDS)).toContain("kết trọn vẹn");
    expect(lifeContinueTask(LIFE_TARGET_WORDS - 500)).toContain(`khoảng ${LIFE_PART_WORDS} từ`);
  });
});

describe("không rập khuôn giữa các truyện", () => {
  it("6 truyện liên tiếp mở 6 kiểu khác nhau", () => {
    expect(new Set([3, 4, 5, 6, 7, 8].map(lifeOpening)).size).toBe(LIFE_OPENINGS.length);
  });
  it("truyện kế nhau không cùng kiểu kết", () => {
    for (let n = 1; n < 20; n++) expect(lifeEnding(n)).not.toBe(lifeEnding(n + 1));
  });
});
