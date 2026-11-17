import { describe, expect, it } from "vitest";
import { blastFilter, blastFontSize, splitHookLines } from "./thumb-blast";

describe("thumbnail chữ nổ", () => {
  it("chia chữ: ngắn 1 dòng, 2–3 từ thành 2 dòng, IN HOA", () => {
    expect(splitHookLines("Ngông!")).toEqual(["NGÔNG!"]);
    expect(splitHookLines("Thách đấu")).toEqual(["THÁCH", "ĐẤU"]);
    expect(splitHookLines("Một kiếm diệt tông")).toEqual(["MỘT KIẾM", "DIỆT TÔNG"]);
    expect(splitHookLines("Mỗi ngày nhận 1000 năm tu vi")).toHaveLength(3);
  });
  it("cỡ chữ: dòng dài nhất vẫn nằm trong nửa phải khung, tối đa 240", () => {
    expect(blastFontSize(["THÁCH", "ĐẤU"])).toBe(240);
    const size = blastFontSize(["MỘT KIẾM", "DIỆT TÔNG"]);
    expect(size * 0.5 * 9).toBeLessThanOrEqual(601);
  });
  it("filter có bóng đổ, viền, ruột chuyển màu; không nhãn, không tên truyện", () => {
    const f = blastFilter("Thách đấu");
    expect(f.startsWith(",split=7")).toBe(true);
    for (const k of ["[drop]", "[strk]", "[fill]", "THÁCH", "ĐẤU"]) expect(f).toContain(k);
    expect(f).not.toContain("box=1");
  });
});

describe("thumbnail đối đầu: chữ dải dưới", () => {
  it("chữ ngắn 1 dòng, dài thì 2 dòng chia đôi", async () => {
    const { bottomLines } = await import("./thumb-blast");
    expect(bottomLines("Thách đấu")).toEqual(["THÁCH ĐẤU"]);
    expect(bottomLines("Một chưởng định sinh tử")).toEqual(["MỘT CHƯỞNG ĐỊNH", "SINH TỬ"]);
  });
  it("căn giữa ngang, tối dần dải dưới", () => {
    const f = blastFilter("Thách đấu", "bottom");
    expect(f).toContain("x=(w-tw)/2");
    expect(f).toContain("Y/H-0.5");
  });
  it("phương án mặc định (a) là đối đầu, chữ dưới", async () => {
    const { DEFAULT_THUMB, THUMB_LAYOUT, THUMB_STYLE } = await import("./thumb-plan");
    expect(DEFAULT_THUMB).toBe("a");
    expect(THUMB_LAYOUT.a).toBe("bottom");
    expect(THUMB_STYLE.a).toContain("villain");
  });
});
