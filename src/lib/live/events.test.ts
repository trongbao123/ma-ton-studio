import { describe, expect, it } from "vitest";
import { backoffMs, diffEvents, formatSse, stableJson } from "./events";

describe("stableJson", () => {
  it("không phụ thuộc thứ tự khoá, giữ thứ tự mảng", () => {
    expect(stableJson({ b: 1, a: { d: 1, c: 2 } })).toBe(stableJson({ a: { c: 2, d: 1 }, b: 1 }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
  });
});

describe("diffEvents", () => {
  it("lần đầu gửi hết, lần sau giống hệt thì không gửi gì", () => {
    const first = diffEvents<"status" | "stats">({}, { status: { q: 1 }, stats: { v: 2 } });
    expect(first.changed.map((c) => c.event)).toEqual(["status", "stats"]);
    const again = diffEvents(first.state, { status: { q: 1 }, stats: { v: 2 } });
    expect(again.changed).toEqual([]);
  });
  it("chỉ gửi khoá đã đổi; thứ tự khoá khác nhưng nội dung giống thì không tính đổi", () => {
    const first = diffEvents<"status" | "flow">({}, { status: { a: 1, b: 2 }, flow: { x: 1 } });
    const next = diffEvents(first.state, { status: { b: 2, a: 1 }, flow: { x: 2 } });
    expect(next.changed).toEqual([{ event: "flow", json: '{"x":2}' }]);
  });
  it("khoá undefined = không đo lần này, giữ trạng thái cũ", () => {
    const first = diffEvents<"status" | "stats">({}, { status: 1, stats: 2 });
    const next = diffEvents(first.state, { status: 1, stats: undefined });
    expect(next.changed).toEqual([]);
    expect(next.state.stats).toBe("2");
  });
});

describe("formatSse", () => {
  it("đúng khung event/data", () => {
    expect(formatSse("status", '{"a":1}')).toBe('event: status\ndata: {"a":1}\n\n');
  });
});

describe("backoffMs", () => {
  it("tăng gấp đôi rồi chặn ở 30s", () => {
    const zero = () => 0;
    expect([1, 2, 3, 4, 10].map((n) => backoffMs(n, zero))).toEqual([1000, 2000, 4000, 8000, 30000]);
  });
  it("nhiễu tối đa 25%", () => {
    expect(backoffMs(1, () => 1)).toBe(1250);
  });
});
