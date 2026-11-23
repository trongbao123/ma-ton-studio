import { describe, expect, it } from "vitest";
import { restoreTts, saveTts } from "./release";

describe("lưu giọng vào release", () => {
  it("ngoài GitHub Actions thì không làm gì (không lỗi)", async () => {
    delete process.env.GITHUB_ACTIONS;
    await expect(saveTts(1, 1, "/tmp")).resolves.toBeUndefined();
    await expect(restoreTts(1, "/tmp")).resolves.toBe(0);
  });
});

describe("vừa giới hạn 2 GB của release", () => {
  it("video 90 phút nén về ~1,8 GB: bitrate hợp lý, không dưới sàn", async () => {
    const { shrinkBitrate } = await import("./release");
    const b = shrinkBitrate(90 * 60);
    expect(b).toBeGreaterThan(2_400_000);
    expect(b).toBeLessThan(2_700_000);
    expect(((b + 192_000) * 90 * 60) / 8).toBeLessThanOrEqual(1.8e9 + 1);
    expect(shrinkBitrate(10 * 3600)).toBe(1_200_000);
  });
});
