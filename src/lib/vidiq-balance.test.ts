import { describe, expect, it } from "vitest";
import { parseBalance } from "./vidiq-balance";

describe("parseBalance", () => {
  it("đọc JSON lồng nhau", () => {
    const b = parseBalance(JSON.stringify({ credits: { remaining: 1200, total: 2000, resetsAt: "2026-12-01T00:00:00Z" }, plan: "Boost" }));
    expect(b).toMatchObject({ remaining: 1200, total: 2000, used: 800, resetAt: "2026-12-01T00:00:00Z", plan: "Boost" });
  });
  it("đọc văn bản thường", () => {
    expect(parseBalance("Credits remaining: 340 of 500").remaining).toBe(340);
  });
});
