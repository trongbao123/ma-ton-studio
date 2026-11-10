import { describe, expect, it } from "vitest";
import { bySource, classifyModel, nextReset } from "./sources";

describe("classifyModel", () => {
  it.each([
    ["claude-haiku-5-5 (gói)", "claude-plan"],
    ["gpt-6-luna (gói)", "chatgpt-plan"],
    ["codex (gói)", "chatgpt-plan"],
    ["gemini-3.8-flash", "gemini-free"],
    ["gemma-4-31b-it", "gemini-free"],
    ["gemini-3.8-flash-tts", "voice"],
    ["@cf/black-forest-labs/flux-1-schnell", "cloudflare"],
    ["black-forest-labs/FLUX-1-schnell", "deepinfra"],
    ["gemini-nano-banana-2.1", "image-paid"],
    ["gpt-image-2", "image-paid"],
    ["claude-opus-5-5", "claude-api"],
    ["gpt-5-mini", "openai-api"],
  ])("%s → %s", (model, id) => expect(classifyModel(model)).toBe(id));
  it("bỏ model nội bộ", () => expect(classifyModel("_notified_quota")).toBeNull());
});

describe("bySource", () => {
  it("cộng lượt và đánh dấu chạm giới hạn theo nguồn", () => {
    const r = bySource([
      { day: "d", model: "gemini-3.8-flash", calls: 20, limited: true },
      { day: "d", model: "gemini-3.6-flash", calls: 5, limited: false },
      { day: "d", model: "claude-haiku-5-5 (gói)", calls: 3, limited: false },
      { day: "d", model: "_notified_quota", calls: 1, limited: false },
    ]);
    // Một model hết lượt nhưng model khác vẫn chạy → "dự phòng", chưa phải dừng hẳn.
    expect(r["gemini-free"]).toMatchObject({ calls: 25, limited: false, partial: true });
    expect(r["gemini-free"]!.models[0].model).toBe("gemini-3.8-flash");
    expect(r["claude-plan"]!.calls).toBe(3);
    expect(Object.keys(r)).toHaveLength(2);
    expect(bySource([{ day: "d", model: "@cf/x", calls: 3, limited: true }]).cloudflare).toMatchObject({ limited: true, partial: false });
  });
});

describe("nextReset", () => {
  it("Gemini reset lúc nửa đêm Los Angeles (15:00 giờ VN mùa đông)", () => {
    const d = nextReset("gemini-free", new Date("2026-11-10T02:00:00Z"))!;
    expect(d.toISOString()).toBe("2026-11-10T08:00:00.000Z");
  });
  it("Cloudflare reset lúc 00:00 UTC (7:00 giờ VN)", () => {
    expect(nextReset("cloudflare", new Date("2026-11-10T02:00:00Z"))!.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });
  it("gói tháng không có giờ reset cố định", () => expect(nextReset("claude-plan")).toBeNull());
});

describe("lampOf", () => {
  it("ưu tiên chạm giới hạn, rồi chưa kết nối, rồi đang dùng", async () => {
    const { lampOf } = await import("./sources");
    expect(lampOf({ calls: 3, limited: true, models: [] }, true)).toBe("limited");
    expect(lampOf(undefined, false)).toBe("off");
    expect(lampOf({ calls: 2, limited: false, models: [] }, false)).toBe("active");
    expect(lampOf(undefined, true)).toBe("idle");
    expect(lampOf({ calls: 4, limited: false, partial: true, models: [] }, true)).toBe("partial");
  });
});
