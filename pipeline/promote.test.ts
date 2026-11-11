import { describe, expect, it } from "vitest";
import { withLeadLink } from "./promote";

describe("withLeadLink", () => {
  it("chèn lên đầu, chạy lại không chồng", () => {
    const once = withLeadLink("Mô tả cũ", "▶ XEM TIẾP TẬP 1: a");
    expect(once).toBe("▶ XEM TIẾP TẬP 1: a\n\nMô tả cũ");
    expect(withLeadLink(once, "▶ XEM TIẾP TẬP 2: b")).toBe("▶ XEM TIẾP TẬP 2: b\n\nMô tả cũ");
  });
});
