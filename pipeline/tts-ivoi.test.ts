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

describe("dùng lại job ivoi cũ", () => {
  it("tiêu đề: ≤ 50 ký tự nguyên văn, dài hơn thì 50 ký tự + ...", async () => {
    const { ivoiTitle } = await import("./tts-ivoi");
    expect(ivoiTitle("nó nói,")).toBe("nó nói,");
    const long = "Các bạn có giữ trong máy một tin nhắn nào của cha mẹ không";
    expect(ivoiTitle(long)).toBe("Các bạn có giữ trong máy một tin nhắn nào của cha ...");
  });
  it("đoạn dài chỉ nhận job có độ dài audio khớp", async () => {
    const { pickOldJob } = await import("./tts-ivoi");
    const text = "a".repeat(187); // ~10 giây
    expect(pickOldJob(text, [{ url: "sai", seconds: 30 }, { url: "dung", seconds: 10 }])).toBe("dung");
    expect(pickOldJob(text, [{ url: "sai", seconds: 2 }])).toBeNull();
    expect(pickOldJob("ngắn", [{ url: "x", seconds: 1 }])).toBe("x");
    expect(pickOldJob(text, undefined)).toBeNull();
  });
});
