import { describe, expect, it } from "vitest";
import { resettableChapters, SYSTEM_MARK, SYSTEM_SECTION, withSystemSection } from "./system";

describe("mục hệ thống trong bible", () => {
  it("withSystemSection chèn đúng một lần", () => {
    const once = withSystemSection("bible cũ");
    expect(once.startsWith("bible cũ")).toBe(true);
    expect(once).toContain(SYSTEM_MARK);
    expect(withSystemSection(once)).toBe(once);
  });
  it("có khuôn thông báo cố định và luật phản phệ", () => {
    expect(SYSTEM_SECTION.startsWith(SYSTEM_MARK)).toBe(true);
    expect(SYSTEM_SECTION).toContain("Thôn phệ thành công.");
    expect(SYSTEM_SECTION).toMatch(/phản phệ/);
  });
});

describe("resettableChapters", () => {
  it("chỉ lấy chương đã viết, chưa có video, sau chương có video cuối", () => {
    const list = [17, 18, 19, 20, 21].map((n) => ({ id: n, number: n, status: n === 21 ? "outline" : "draft" }));
    expect(resettableChapters(list, new Set([17, 18])).map((c) => c.number)).toEqual([19, 20]);
  });
  it("chương chưa video nằm TRƯỚC chương có video thì giữ", () => {
    const list = [
      { id: 1, number: 1, status: "draft" },
      { id: 2, number: 2, status: "approved" },
    ];
    expect(resettableChapters(list, new Set([2]))).toEqual([]);
  });
});
