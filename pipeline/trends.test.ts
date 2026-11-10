import { describe, expect, it } from "vitest";
import { fitArgs } from "./trends";

describe("fitArgs", () => {
  const schema = { properties: { keyword: {}, publishedWithin: { enum: ["7d", "30d"] } } };
  it("bỏ tham số không có trong schema và giá trị ngoài enum", () => {
    expect(fitArgs(schema, { keyword: "a", limit: 5, publishedWithin: "30d" })).toEqual({ keyword: "a", publishedWithin: "30d" });
    expect(fitArgs(schema, { keyword: "a", publishedWithin: "90d" })).toEqual({ keyword: "a" });
  });
  it("không biết schema thì giữ nguyên", () => {
    expect(fitArgs(null, { a: 1 })).toEqual({ a: 1 });
  });
});
