import { describe, expect, it } from "vitest";
import { cleanTags, FIXED_TAGS, tagCost } from "./youtube-tags";

const total = (tags: string[]) => tags.reduce((n, t, i) => n + tagCost(t) + (i ? 1 : 0), 0);

describe("cleanTags", () => {
  it("luôn có đủ bộ tag cố định, đứng đầu, đúng thứ tự", () => {
    const out = cleanTags(["Thần Ma Táng Cổ", "Lâm Uyên"]);
    expect(out.slice(0, FIXED_TAGS.length)).toEqual(FIXED_TAGS);
    expect(out.slice(FIXED_TAGS.length)).toEqual(["Thần Ma Táng Cổ", "Lâm Uyên"]);
  });

  it("bỏ tag AI trùng bộ cố định (không phân biệt hoa thường)", () => {
    const out = cleanTags(["Truyện Audio", "tu tiên", "Lâm Uyên"]);
    expect(out.filter((t) => t.toLowerCase() === "truyện audio")).toHaveLength(1);
    expect(out.filter((t) => t.toLowerCase() === "tu tiên")).toHaveLength(1);
    expect(out.at(-1)).toBe("Lâm Uyên");
  });

  it("không vượt 500 ký tự theo cách YouTube đếm", () => {
    const many = Array.from({ length: 60 }, (_, i) => `tag dài số ${i} cho truyện`);
    expect(total(cleanTags(many))).toBeLessThanOrEqual(500);
  });

  it("bộ cố định tự nó vừa giới hạn, còn chỗ cho tên truyện", () => {
    expect(total(FIXED_TAGS)).toBeLessThan(440);
  });

  it("vẫn bỏ ký tự cấm < > , và tag rỗng", () => {
    const out = cleanTags(["  ", "a<b>", "x,y"]);
    expect(out.slice(FIXED_TAGS.length)).toEqual(["ab", "xy"]);
  });
});

describe("điểm vidIQ của bộ tag cố định", () => {
  it("tag nào trong bộ cũng có điểm vidIQ thật (lấy từ Studio của chủ kênh)", async () => {
    const { FIXED_TAG_SCORES } = await import("./youtube-tags");
    for (const t of FIXED_TAGS) expect(FIXED_TAG_SCORES[t]).toBeGreaterThan(0);
    expect(FIXED_TAG_SCORES["audio truyện"]).toBe(79);
  });
});
