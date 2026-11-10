import { describe, expect, it } from "vitest";
import { fluxSize } from "./images";

describe("fluxSize", () => {
  it("giữ đúng khung video dài / Short (bội số 64)", () => {
    expect(fluxSize({ width: 1280, height: 768, seed: 1 })).toBe("1280x768");
    expect(fluxSize({ width: 768, height: 1408, seed: 1 })).toBe("768x1408");
  });
  it("ảnh quá lớn thì thu về ~1,3 MP cho đỡ tiền", () => {
    const [w, h] = fluxSize({ width: 2048, height: 2048, seed: 1 }).split("x").map(Number);
    expect(w * h).toBeLessThanOrEqual(1280 * 1024 * 1.05);
    expect(w % 64).toBe(0);
    expect(h % 64).toBe(0);
  });
});

describe("ảnh bị chặn kiểm duyệt", () => {
  it("nhận ra lỗi moderation của OpenAI, không nhầm với hết lượt", async () => {
    const { isModerationBlock } = await import("./images");
    expect(isModerationBlock(new Error('codex (gói) lỗi: ... safety_violations=[self-harm, violence]. "code": "moderation_blocked"'))).toBe(true);
    expect(isModerationBlock(new Error("rate limit reached"))).toBe(false);
  });
  it("prompt dịu: bỏ từ máu me, giữ bố cục, thêm ràng buộc an toàn", async () => {
    const { softenPrompt } = await import("./images");
    const p = softenPrompt("Lin Yuan stabbing the giant toad, blood spraying, corpses of hunters around, glowing green poison mist, low angle");
    expect(p).not.toMatch(/blood spraying|corpses|stabbing/i);
    expect(p).toContain("giant toad");
    expect(p).toContain("glowing green poison mist");
    expect(p).toContain("no blood");
  });
});
