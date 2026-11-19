import { describe, expect, it } from "vitest";
import { restoreTts, saveTts } from "./release";

describe("lưu giọng vào release", () => {
  it("ngoài GitHub Actions thì không làm gì (không lỗi)", async () => {
    delete process.env.GITHUB_ACTIONS;
    await expect(saveTts(1, 1, "/tmp")).resolves.toBeUndefined();
    await expect(restoreTts(1, "/tmp")).resolves.toBe(0);
  });
});
