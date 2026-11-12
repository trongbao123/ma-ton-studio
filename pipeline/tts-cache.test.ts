import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dropStaleTts, markTts } from "./tts-cache";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "tts-cache-"));
  const wav = path.join(dir, "tts-A-000.wav");
  const fast = path.join(dir, "tts-A-000-x1.2.wav");
  await writeFile(wav, "old");
  await writeFile(fast, "old");
  return { wav, fast };
}

describe("cache giọng đọc theo văn bản", () => {
  it("văn bản đoạn đổi thì xoá file giọng cũ (cả bản tăng tốc) để đọc lại", async () => {
    const { wav, fast } = await setup();
    await markTts(wav, "Thần Ma Táng Cổ. Chương 1. Câu đầu.");
    await dropStaleTts(wav, [fast], "Câu đầu.");
    expect(existsSync(wav)).toBe(false);
    expect(existsSync(fast)).toBe(false);
  });
  it("văn bản giữ nguyên thì giữ cache", async () => {
    const { wav, fast } = await setup();
    await markTts(wav, "Câu đầu.");
    await dropStaleTts(wav, [fast], "Câu đầu.");
    expect(await readFile(wav, "utf8")).toBe("old");
    expect(existsSync(fast)).toBe(true);
  });
  it("file cũ chưa có dấu văn bản (cache trước bản sửa) thì vẫn dùng — không đốt lại lượt giọng", async () => {
    const { wav, fast } = await setup();
    await dropStaleTts(wav, [fast], "gì cũng được");
    expect(existsSync(wav)).toBe(true);
  });
});
