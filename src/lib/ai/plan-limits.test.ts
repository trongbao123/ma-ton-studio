import { describe, expect, it } from "vitest";
import { parseClaudeHeaders, parseClaudeUsage, parseCodexRateLimits, windowLabel } from "./plan-limits";

describe("parseCodexRateLimits", () => {
  it("app-server (camelCase): đo thật trên codex-cli 0.166", () => {
    const raw = {
      rateLimits: { primary: { usedPercent: 87, windowDurationMins: 10080, resetsAt: 1794411469 }, secondary: null, planType: "pro" },
    };
    expect(parseCodexRateLimits(raw)).toEqual({
      windows: [{ label: "Tuần", percent: 87, resetsAt: new Date(1794411469 * 1000).toISOString() }],
      plan: "pro",
    });
  });
  it("token_count (snake_case, resets_in_seconds) với primary + secondary", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const raw = {
      primary: { used_percent: 12.5, window_minutes: 300, resets_in_seconds: 3600 },
      secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1794411469 },
      plan_type: "plus",
    };
    const { windows, plan } = parseCodexRateLimits(raw, now);
    expect(plan).toBe("plus");
    expect(windows[0]).toEqual({ label: "Khung 5 giờ", percent: 12.5, resetsAt: "2026-11-10T01:00:00.000Z" });
    expect(windows[1].label).toBe("Tuần");
  });
  it("rác → rỗng; cửa sổ thiếu used_percent bị bỏ", () => {
    expect(parseCodexRateLimits(null)).toEqual({ windows: [], plan: null });
    expect(parseCodexRateLimits({ primary: { window_minutes: 300 } }).windows).toEqual([]);
  });
  it("chặn phần trăm trong 0–100", () => {
    expect(parseCodexRateLimits({ primary: { used_percent: 130 } }).windows[0].percent).toBe(100);
  });
});

describe("parseClaudeUsage", () => {
  it("five_hour + seven_day, bỏ cửa sổ null", () => {
    const raw = {
      five_hour: { utilization: 37, resets_at: "2026-11-10T12:00:00+00:00" },
      seven_day: { utilization: 61.4, resets_at: "2026-11-14T03:00:00+00:00" },
      seven_day_opus: null,
    };
    expect(parseClaudeUsage(raw)).toEqual([
      { label: "Khung 5 giờ", percent: 37, resetsAt: "2026-11-10T12:00:00+00:00" },
      { label: "Tuần", percent: 61.4, resetsAt: "2026-11-14T03:00:00+00:00" },
    ]);
  });
  it("phản hồi lỗi → rỗng", () => {
    expect(parseClaudeUsage({ type: "error" })).toEqual([]);
    expect(parseClaudeUsage(undefined)).toEqual([]);
  });
});

describe("parseClaudeHeaders", () => {
  it("utilization 0–1 → phần trăm, reset epoch giây", () => {
    const h: Record<string, string> = {
      "anthropic-ratelimit-unified-5h-utilization": "0.25",
      "anthropic-ratelimit-unified-5h-reset": "1794411469",
      "anthropic-ratelimit-unified-7d-utilization": "0.8",
    };
    expect(parseClaudeHeaders((n) => h[n] ?? null)).toEqual([
      { label: "Khung 5 giờ", percent: 25, resetsAt: new Date(1794411469 * 1000).toISOString() },
      { label: "Tuần", percent: 80, resetsAt: null },
    ]);
  });
  it("không có header → rỗng", () => expect(parseClaudeHeaders(() => null)).toEqual([]));
});

describe("windowLabel", () => {
  it.each([
    [300, "Khung 5 giờ"],
    [10080, "Tuần"],
    [1440, "1 ngày"],
    [45, "Khung 45 phút"],
    [null, "Khung giới hạn"],
  ] as const)("%s", (m, label) => expect(windowLabel(m)).toBe(label));
});
