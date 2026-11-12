import { describe, expect, it } from "vitest";
import { chapterNarration } from "./narration";

describe("chapterNarration", () => {
  it("chỉ đọc nội dung chương — không đọc tên truyện/tên chương ở đầu", () => {
    expect(chapterNarration("  Câu thoại đầu tiên.  ")).toBe("Câu thoại đầu tiên.");
  });
});
