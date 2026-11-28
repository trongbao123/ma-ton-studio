import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claimRenderDir, renderDirOwner } from "./render-dir";

const tmp = () => mkdtemp(path.join(os.tmpdir(), "render-dir-"));
const owner = renderDirOwner(20, new Date("2026-11-25T00:00:00Z"));

describe("claimRenderDir", () => {
  it("thư mục chưa có: tạo mới, ghi nhãn, không tính là xoá", async () => {
    const dir = path.join(await tmp(), "video-20");
    expect(await claimRenderDir(dir, owner)).toBe(false);
    expect(await readdir(dir)).toEqual([".owner"]);
  });

  it("thư mục của video cũ trùng id (không nhãn): xoá ảnh cũ", async () => {
    const dir = path.join(await tmp(), "video-20");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "long-img-0.jpg"), "ảnh video cũ");
    expect(await claimRenderDir(dir, owner)).toBe(true);
    expect(await readdir(dir)).toEqual([".owner"]);
  });

  it("nhãn khác (cùng id, khác ngày tạo): xoá", async () => {
    const dir = path.join(await tmp(), "video-20");
    await claimRenderDir(dir, renderDirOwner(20, new Date("2026-10-01T00:00:00Z")));
    await writeFile(path.join(dir, "long-img-0.jpg"), "x");
    expect(await claimRenderDir(dir, owner)).toBe(true);
    expect(await readdir(dir)).toEqual([".owner"]);
  });

  it("đúng nhãn: giữ nguyên ảnh đã vẽ ở lượt trước", async () => {
    const dir = path.join(await tmp(), "video-20");
    await claimRenderDir(dir, owner);
    await writeFile(path.join(dir, "long-img-0.jpg"), "x");
    expect(await claimRenderDir(dir, owner)).toBe(false);
    expect((await readdir(dir)).sort()).toEqual([".owner", "long-img-0.jpg"]);
  });
});
