import { describe, expect, it } from "vitest";
import { chunk } from "./batch";

describe("chunk", () => {
  it("chia 120 id thành lô 50/50/20", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    expect(chunk(ids, 50).map((c) => c.length)).toEqual([50, 50, 20]);
  });
  it("rỗng thì không có lô; đúng bội số thì không dư lô rỗng", () => {
    expect(chunk([], 50)).toEqual([]);
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });
  it("size sai thì ném lỗi", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
