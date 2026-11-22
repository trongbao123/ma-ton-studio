import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SPRITE_STYLE, spriteDataUri, spritePrompt } from "./sprites";

describe("prompt vẽ lính giấy", () => {
  it("có kiểu vẽ chung, có phe và thời kỳ, không có chi tiết hiện đại", () => {
    const prompt = spritePrompt({ kind: "infantry", side: "quân Tây Sơn", era: "Việt Nam cuối thế kỷ 18" });
    expect(prompt).toContain(SPRITE_STYLE);
    expect(prompt).toContain("quân Tây Sơn");
    expect(prompt).toContain("Việt Nam cuối thế kỷ 18");
    for (const modern of ["tactical", "modern", "rifle", "camouflage"]) expect(prompt.toLowerCase()).not.toContain(modern);
  });

  it("mỗi loại quân có mô tả riêng", () => {
    const base = { side: "quân Thanh", era: "thế kỷ 18" };
    expect(spritePrompt({ ...base, kind: "cavalry" })).not.toBe(spritePrompt({ ...base, kind: "infantry" }));
    expect(spritePrompt({ ...base, kind: "elephant" })).toMatch(/elephant/i);
  });
});

describe("vẽ lính giấy (có cache)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("vẽ một lần rồi dùng lại, không gọi AI lần hai", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sprite-"));
    const draw = vi.fn(async (_prompt: string, file: string) => void (await writeFile(file, Buffer.alloc(20_000))));
    const { ensureSprite } = await import("./sprites");
    const spec = { kind: "infantry" as const, side: "Tây Sơn", era: "1789", dir, draw, cutout: async () => {} };
    const first = await ensureSprite(spec);
    const second = await ensureSprite(spec);
    expect(second).toBe(first);
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it("ảnh vẽ hỏng (quá nhỏ) → ném lỗi, không lưu làm cache", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sprite-"));
    const draw = vi.fn(async (_prompt: string, file: string) => void (await writeFile(file, Buffer.alloc(10))));
    const { ensureSprite } = await import("./sprites");
    await expect(ensureSprite({ kind: "cavalry", side: "Thanh", era: "1789", dir, draw, cutout: async () => {} })).rejects.toThrow(/hỏng|nhỏ/i);
  });
});

describe("nhúng ảnh vào SVG", () => {
  it("đổi PNG thành data URI", async () => {
    const file = path.join(await mkdtemp(path.join(tmpdir(), "sprite-")), "a.png");
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(await spriteDataUri(file)).toBe("data:image/png;base64,iVBORw==");
  });
});
