import { describe, expect, it } from "vitest";
import { heroKey, heroPrompt } from "./hero";
import { scenesRequest } from "./prompts";

describe("ảnh mẫu nam chính", () => {
  it("prompt ảnh mẫu: một người, toàn thân, mặt rõ, nền trơn, có mô tả cố định", () => {
    const p = heroPrompt("black hair, silver-grey tattered robe");
    expect(p).toContain("black hair, silver-grey tattered robe");
    expect(p).toMatch(/ONE young man/);
    expect(p).toMatch(/plain .*background/);
  });
  it("khóa lưu theo bộ truyện", () => {
    expect(heroKey(4)).toBe("hero_ref_4");
  });
  it("prompt cảnh yêu cầu đánh dấu hero (cảnh có nam chính mới gửi ảnh mẫu)", () => {
    expect(scenesRequest("look", ["a"]).prompt).toContain("hero=true");
  });
});
