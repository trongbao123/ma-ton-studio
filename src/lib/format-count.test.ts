import { describe, expect, it } from "vitest";
import { formatCount } from "./format-count";

describe("formatCount", () => {
  it("giữ nguyên dưới 1000", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
  });
  it("nghìn: 1 chữ số thập phân dưới 10N, bỏ thập phân từ 10N", () => {
    expect(formatCount(1_000)).toBe("1N");
    expect(formatCount(1_234)).toBe("1,2N");
    expect(formatCount(9_999)).toBe("9,9N");
    expect(formatCount(34_567)).toBe("34N");
    expect(formatCount(999_999)).toBe("999N");
  });
  it("triệu và tỷ", () => {
    expect(formatCount(1_000_000)).toBe("1Tr");
    expect(formatCount(3_456_789)).toBe("3,4Tr");
    expect(formatCount(12_345_678)).toBe("12Tr");
    expect(formatCount(1_560_000_000)).toBe("1,5Tỷ");
  });
  it("giá trị lạ về 0", () => {
    expect(formatCount(-5)).toBe("0");
    expect(formatCount(Number.NaN)).toBe("0");
  });
});
