import { describe, expect, it } from "vitest";
import { genreSeeds, parseKeywordTable, parseScoredTitles } from "./vidiq";

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

// Mẫu thật từ vidiq_keyword_research (2026-11-10).
const SAMPLE = `## Keyword research — mode: research

### seedKeyword (1)
| keyword | volume | competition | overall | estimatedMonthlySearch | searchDemandGrowthPct | topMarkets (top 3) |
|---|---|---|---|---|---|---|
| truyện tiên hiệp | 69 | 34 | 68 | 41678 | null | none |

### relatedKeywords (2)
| keyword | volume | competition | overall | estimatedMonthlySearch | searchDemandGrowthPct | topMarkets (top 3) |
|---|---|---|---|---|---|---|
| truyện tiên hiệp full | 0 | 29 | 28 | <750 | null | none |
| truyện tu tiên | 69 | 25 | 71 | 38984 | +74.4% | VN 100% |`;

describe("vidIQ", () => {
  it("đọc bảng từ khóa, bỏ dòng tiêu đề và dòng kẻ", () => {
    const k = parseKeywordTable(SAMPLE);
    expect(k.map((x) => x.keyword)).toEqual(["truyện tiên hiệp", "truyện tiên hiệp full", "truyện tu tiên"]);
    expect(k[2]).toMatchObject({ volume: 69, competition: 25, overall: 71, monthly: "38984" });
  });

  it("từ khóa gốc theo thể loại, không dùng tên truyện", () => {
    expect(genreSeeds("tiên hiệp")).toContain("truyện tu tiên");
    expect(genreSeeds("huyền huyễn")[0]).toBe("truyện huyền huyễn");
  });
});
