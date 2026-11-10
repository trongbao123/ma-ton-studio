import { describe, expect, it } from "vitest";
import { buildChapterMarks, collectMusicCredits, compileLabel, formatTimestamp, nextCompileSlot, pickBatch } from "./compile-plan";

const cand = (number: number, videoId = number * 10) => ({ chapterId: number, number, title: `C${number}`, videoId });

describe("formatTimestamp", () => {
  it("dưới 1 giờ: MM:SS", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(75.9)).toBe("01:15");
    expect(formatTimestamp(3599)).toBe("59:59");
  });
  it("từ 1 giờ: H:MM:SS", () => {
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });
});

describe("buildChapterMarks", () => {
  it("dòng đầu 00:00, các mốc cộng dồn", () => {
    const out = buildChapterMarks([
      { number: 1, title: "Khởi đầu", seconds: 600 },
      { number: 2, title: "Huyết Ma", seconds: 1500 },
      { number: 3, title: "Kết", seconds: 900 },
    ]);
    expect(out.split("\n")).toEqual(["00:00 Chương 1: Khởi đầu", "10:00 Chương 2: Huyết Ma", "35:00 Chương 3: Kết"]);
  });
  it("vượt 1 giờ thì mốc sau dùng H:MM:SS", () => {
    const out = buildChapterMarks([
      { number: 1, title: "A", seconds: 3700 },
      { number: 2, title: "B", seconds: 10 },
    ]);
    expect(out.split("\n")[1]).toBe("1:01:40 Chương 2: B");
  });
});

describe("pickBatch", () => {
  it("lấy 5 chương liền nhau sớm nhất", () => {
    expect(pickBatch([6, 1, 2, 3, 4, 5, 7].map((n) => cand(n)))?.map((c) => c.number)).toEqual([1, 2, 3, 4, 5]);
  });
  it("đứt quãng thì tìm đoạn liền kế tiếp", () => {
    expect(pickBatch([1, 2, 4, 5, 6, 7, 8].map((n) => cand(n)))?.map((c) => c.number)).toEqual([4, 5, 6, 7, 8]);
  });
  it("ít hơn 5 liên tiếp thì null", () => {
    expect(pickBatch([1, 2, 3, 4, 6, 7].map((n) => cand(n)))).toBeNull();
  });
  it("chương có 2 video thì lấy video mới nhất", () => {
    const list = [cand(1), cand(1, 99), cand(2), cand(3), cand(4), cand(5)];
    expect(pickBatch(list)?.[0].videoId).toBe(99);
  });
});

describe("collectMusicCredits", () => {
  const credit = (t: string) => `\n\nNhạc nền: "${t}" – Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttp://creativecommons.org/licenses/by/4.0/`;
  it("gom khối ghi công, bỏ trùng", () => {
    const out = collectMusicCredits([`Mô tả 1${credit("A")}`, `Mô tả 2${credit("A")}`, `Mô tả 3${credit("B")}`, "Không nhạc"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('"A"');
    expect(out[1]).toContain('"B"');
  });
});

describe("nextCompileSlot", () => {
  it("lấy 05:00 UTC hôm nay nếu còn ≥ 2 giờ", () => {
    expect(nextCompileSlot([], new Date("2026-11-10T01:00:00Z")).toISOString()).toBe("2026-11-10T05:00:00.000Z");
  });
  it("quá muộn thì sang ngày mai", () => {
    expect(nextCompileSlot([], new Date("2026-11-10T04:00:00Z")).toISOString()).toBe("2026-11-11T05:00:00.000Z");
  });
  it("bỏ qua khung đã có người giữ", () => {
    const taken = [new Date("2026-11-11T05:00:00Z")];
    expect(nextCompileSlot(taken, new Date("2026-11-10T06:00:00Z")).toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });
});

describe("compileLabel", () => {
  it("dùng gạch ngang dài", () => expect(compileLabel(1, 5)).toBe("1–5"));
});
