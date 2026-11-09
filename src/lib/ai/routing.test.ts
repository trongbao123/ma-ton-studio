import { describe, expect, it } from "vitest";
import { defaultRouting, normalizeRouting, promote } from "./routing";

describe("defaultRouting", () => {
  it("chia việc theo thế mạnh: truyện Opus, meta Sonnet, việc nhẹ Gemini trước", () => {
    const d = defaultRouting();
    expect(d.story[0]).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(d.meta[0]).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect(d.summary[0].provider).toBe("gemini");
    expect(d.scenes[0].provider).toBe("gemini");
  });
  it("chưa lưu gì thì dùng mặc định", () => expect(normalizeRouting(null)).toEqual(defaultRouting()));
});

describe("promote", () => {
  it("đưa AI lên đầu, bỏ trùng, giữ AI khác làm dự phòng", () => {
    const out = promote(defaultRouting(), "meta", { provider: "gemini", model: "" });
    expect(out.meta).toEqual([
      { provider: "gemini", model: "" },
      { provider: "anthropic", model: "claude-sonnet-5-5" },
      { provider: "openai", model: "gpt-5" },
    ]);
    expect(out.story).toEqual(defaultRouting().story);
  });
});
