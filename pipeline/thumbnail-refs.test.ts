import { describe, expect, it, vi } from "vitest";

const drawImage = vi.fn(async () => "gpt");
vi.mock("./images", () => ({ drawImage }));
vi.mock("./ffmpeg", async (orig) => ({ ...(await orig<typeof import("./ffmpeg")>()), ffmpeg: vi.fn(async () => undefined) }));

describe("thumbnail", () => {
  // Nạp render.ts (nặng) có lúc quá 5 giây khi chạy cả bộ song song.
  it("gửi kèm ảnh mẫu nam chính cho AI vẽ", { timeout: 30_000 }, async () => {
    const { thumbnail } = await import("./render");
    await thumbnail("/tmp/x", "prompt", "NUỐT CỔ THẦN", "FULL 1H40", { name: "thumb-a", seed: 42, refs: ["/x/hero-ref.jpg"] });
    expect(drawImage).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({ refs: ["/x/hero-ref.jpg"] }));
  });
});
