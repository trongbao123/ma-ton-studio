import { describe, expect, it } from "vitest";
import { parseScoredTitles } from "./vidiq";

describe("parseScoredTitles", () => {
  it("đọc JSON lồng nhau", () => {
    const text = JSON.stringify({ titles: [{ title: "Thần Ma Táng Cổ chương 2: rèn đúc quyết sinh", score: 87 }, { text: "Lâm Uyên bùng nổ sát ý giữa vòng vây", overallScore: "74" }] });
    expect(parseScoredTitles(text)).toEqual([
      { title: "Thần Ma Táng Cổ chương 2: rèn đúc quyết sinh", score: 87 },
      { title: "Lâm Uyên bùng nổ sát ý giữa vòng vây", score: 74 },
    ]);
  });
  it("đọc dạng danh sách chữ", () => {
    const text = "Gợi ý:\n1. **Thần Ma Táng Cổ: Lâm Uyên rèn đúc** — 82\n2. \"Sát ý bùng nổ giữa trạm gác số bảy\" (score: 79/100)\nghi chú khác";
    expect(parseScoredTitles(text)).toEqual([
      { title: "Thần Ma Táng Cổ: Lâm Uyên rèn đúc", score: 82 },
      { title: "Sát ý bùng nổ giữa trạm gác số bảy", score: 79 },
    ]);
  });
  it("không đọc được thì trả rỗng", () => expect(parseScoredTitles("lỗi gì đó")).toEqual([]));
});
