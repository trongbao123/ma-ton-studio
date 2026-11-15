import { describe, expect, it } from "vitest";
import { focusKeywords, norm, scoreDescription, scoreMeta, scoreShort, scoreTags, scoreTitle } from "./seo";

const kw = focusKeywords("Thần Ma Táng Cổ: Thôn Thiên Lục");
const tags = ["thần ma táng cổ", "thôn thiên lục", "truyện tiên hiệp", "lâm uyên", "truyện audio", "audio tiên hiệp hay nhất"];

describe("norm / focusKeywords", () => {
  it("bỏ dấu và chữ đ", () => expect(norm("Đấu La Đại Lục!")).toBe("dau la dai luc"));
  it("tách tên truyện theo dấu hai chấm", () => expect(kw).toEqual(["Thần Ma Táng Cổ", "Thôn Thiên Lục"]));
});

describe("scoreTitle", () => {
  it("tiêu đề tốt được điểm cao", () => {
    const s = scoreTitle("Thần Ma Táng Cổ - Chương 2: Lâm Uyên rèn đúc quyết sinh", kw, tags);
    expect(s.source).toBe("app");
    expect(s.score).toBeGreaterThanOrEqual(80);
  });
  it("thiếu từ khóa và in hoa toàn bộ thì thấp", () => {
    expect(scoreTitle("SÁT Ý BÙNG NỔ KINH HOÀNG", kw, tags).score).toBeLessThan(40);
  });
  it("có điểm vidIQ thì lấy điểm vidIQ — tiêu đề giật tít không cần từ khóa", () => {
    const good = "Thần Ma Táng Cổ - Chương 2: Lâm Uyên rèn đúc quyết sinh";
    expect(scoreTitle(good, kw, tags, 73.4)).toMatchObject({ score: 73, source: "vidiq" });
    const s = scoreTitle("Thanh niên quá ngông đòi cân cả lò team địch và cái kết ăn hành ngập mồm", kw, tags, 95, ["truyện tu tiên"]);
    expect(s.score).toBe(95);
    expect(s.checks.length).toBeGreaterThan(0);
  });
});

describe("scoreDescription", () => {
  it("mô tả ngắn không từ khóa thì thấp, mô tả đầy đủ thì cao", () => {
    expect(scoreDescription("Hay lắm.", kw, tags).score).toBeLessThan(20);
    const long = [
      `Thần Ma Táng Cổ chương mới: Lâm Uyên đối mặt lũ thợ săn. ${"Truyện tiên hiệp audio đầy kịch tính. ".repeat(30)}`,
      "Hãy đăng ký kênh và bấm like để nghe Thần Ma Táng Cổ, thôn thiên lục, truyện audio mỗi ngày.",
      "#truyenaudio #tienhiep #thanmatangco",
    ].join("\n\n");
    expect(scoreDescription(long, kw, tags).score).toBeGreaterThanOrEqual(80);
  });
});

describe("giữ dấu như vidIQ", () => {
  it("tag không dấu không tính là khớp tiêu đề/mô tả và bị trừ điểm", () => {
    const title = "Truyện tu tiên: Lâm Uyên rèn đúc | Thần Ma Táng Cổ Chương 2";
    const desc = "Thần Ma Táng Cổ, truyện audio tiên hiệp. Truyện tu tiên mới.";
    const search = ["truyện tu tiên", "truyện audio", "tiên hiệp"];
    const accented = scoreTags(["truyện tu tiên", "truyện audio", "thần ma táng cổ", "tiên hiệp"], kw, title, desc, search);
    const plain = scoreTags(["truyen tu tien", "truyen audio", "than ma tang co", "tien hiep"], kw, title, desc, search);
    expect(plain.checks.find((c) => c.text.includes("không dấu"))?.ok).toBe(false);
    expect(accented.checks.find((c) => c.text.includes("có dấu"))?.ok).toBe(true);
    expect(plain.score).toBeLessThan(accented.score - 30);
  });
});

describe("scoreTags", () => {
  it("phát hiện tag trùng", () => {
    const s = scoreTags(["a b", "A B"], kw, "", "");
    expect(s.checks.find((c) => c.text.includes("trùng"))?.ok).toBe(false);
  });
});

describe("scoreShort", () => {
  it("có #shorts, ngắn, có tên truyện", () => {
    expect(scoreShort("Thần Ma Táng Cổ: bóp nát tay kẻ thù #shorts", "Xem full trên kênh nhé các bạn ơi", kw).score).toBe(100);
  });
});

describe("scoreMeta", () => {
  it("trả đủ 4 mục", () => {
    const r = scoreMeta({ title: "t", description: "d", tags: [], shortTitle: "s", shortDescription: "" }, "Thần Ma Táng Cổ");
    expect(Object.keys(r)).toEqual(["title", "description", "tags", "short"]);
  });
});
