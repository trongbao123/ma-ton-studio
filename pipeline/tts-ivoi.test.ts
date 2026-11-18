import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { speakIvoi } from "./tts-ivoi";

describe("speakIvoi", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("file đã có (cache) → không gọi API (không tốn credit)", async () => {
    const f = path.join(await mkdtemp(path.join(tmpdir(), "ivoi-")), "a.wav");
    await writeFile(f, "x");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await speakIvoi("xin chào", f, "vi_quynhanh_ipa");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
