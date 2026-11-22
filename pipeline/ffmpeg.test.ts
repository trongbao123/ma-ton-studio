import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoizeAsync, once } from "./ffmpeg";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "once-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("once", () => {
  it("tạo file qua file tạm rồi đổi tên; lần sau bỏ qua", async () => {
    const file = path.join(dir, "long-shot2-000.mp4");
    let calls = 0;
    const make = async (tmp: string) => {
      calls++;
      expect(tmp).toBe(path.join(dir, "long-shot2-000.part.mp4"));
      await writeFile(tmp, "video");
    };
    expect(await once(file, make)).toBe(true);
    expect(await once(file, make)).toBe(false);
    expect(calls).toBe(1);
    expect(await readFile(file, "utf8")).toBe("video");
    expect(await readdir(dir)).toEqual(["long-shot2-000.mp4"]);
  });
  it("job bị huỷ giữa chừng (lỗi khi đang ghi) → không để lại file chính, lần sau làm lại", async () => {
    const file = path.join(dir, "long.mp4");
    await expect(
      once(file, async (tmp) => {
        await writeFile(tmp, "dở dang");
        throw new Error("bị huỷ");
      }),
    ).rejects.toThrow("bị huỷ");
    expect(await once(file, (tmp) => writeFile(tmp, "đủ"))).toBe(true);
    expect(await readFile(file, "utf8")).toBe("đủ");
  });
  it("file rỗng coi như chưa có", async () => {
    const file = path.join(dir, "x.mp4");
    await writeFile(file, "");
    expect(await once(file, (tmp) => writeFile(tmp, "ok"))).toBe(true);
  });
});

describe("memoizeAsync", () => {
  it("gọi nhiều lần, kể cả song song, việc nặng chỉ chạy một lần", async () => {
    let calls = 0;
    const draw = memoizeAsync(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return "sprite.png";
    });
    const [a, b, c] = await Promise.all([draw(), draw(), draw()]);
    expect([a, b, c]).toEqual(["sprite.png", "sprite.png", "sprite.png"]);
    expect(await draw()).toBe("sprite.png");
    expect(calls).toBe(1);
  });
});
