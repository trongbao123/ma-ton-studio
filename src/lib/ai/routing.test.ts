import { describe, expect, it } from "vitest";
import { defaultRouting, normalizeRouting, promote } from "./routing";

describe("defaultRouting", () => {
  it("gói Pro/Plus (CLI) đứng trước API: truyện Claude, meta ChatGPT, việc nhẹ Gemini API free", () => {
    const d = defaultRouting();
    expect(d.story[0]).toEqual({ provider: "claude-cli", model: "sonnet" });
    expect(d.story[1]).toEqual({ provider: "claude-cli", model: "haiku" });
    expect(d.meta[0]).toEqual({ provider: "codex-cli", model: "gpt-6-luna" });
    expect(d.summary[0].provider).toBe("gemini");
    expect(d.scenes[0].provider).toBe("gemini");
    // Gemini CLI bị Google chặn cho tài khoản cá nhân → không đưa vào mặc định.
    for (const t of Object.values(d)) expect(t.some((x) => x.provider === "gemini-cli")).toBe(false);
    // Gemini API free luôn còn trong chuỗi để không bao giờ kẹt khi hết lượt gói.
    for (const t of Object.values(d)) expect(t.some((x) => x.provider === "gemini")).toBe(true);
  });
  it("chưa lưu gì thì dùng mặc định", () => expect(normalizeRouting(null)).toEqual(defaultRouting()));
});

describe("promote", () => {
  it("đưa AI lên đầu, bỏ trùng, giữ AI khác làm dự phòng", () => {
    const out = promote(defaultRouting(), "meta", { provider: "gemini", model: "" });
    expect(out.meta[0]).toEqual({ provider: "gemini", model: "" });
    expect(out.meta.filter((x) => x.provider === "gemini")).toHaveLength(1);
    expect(out.meta).toHaveLength(defaultRouting().meta.length);
    expect(out.story).toEqual(defaultRouting().story);
  });
});
