import { describe, expect, it } from "vitest";
import { genreSeeds, onTopic, parseKeywordTable, parseScoredTitles, parseThumbScore, thumbScoreArgs } from "./vidiq";

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
  it("bỏ từ khóa lạc ngách", () => {
    expect(onTopic("truyện tu tiên")).toBe(true);
    expect(onTopic("review truyện tranh")).toBe(false);
    expect(onTopic("hh vietsub")).toBe(false);
  });
});

describe("parseThumbScore", () => {
  it("đọc JSON {score} trực tiếp, lồng và dạng chuỗi", () => {
    expect(parseThumbScore('{"score":67}')).toBe(67);
    expect(parseThumbScore('{"result":{"score":"81.5"}}')).toBe(81.5);
    expect(parseThumbScore('{"score":0}')).toBe(0);
  });
  it("đọc câu chữ; điểm ngoài 0–100 hoặc không có điểm → null", () => {
    expect(parseThumbScore("Thumbnail score: 72 / 100")).toBe(72);
    expect(parseThumbScore('{"score":250}')).toBeNull();
    expect(parseThumbScore("lỗi không xác định")).toBeNull();
    expect(parseThumbScore('{"foo":1}')).toBeNull();
  });
});

describe("thumbScoreArgs", () => {
  const o = { videoId: "abc", title: "T", imageUrl: "https://x/y.jpg" };
  it("image kiểu string → đưa URL; có title thì gửi title", () => {
    const schema = { properties: { videoId: { type: "string" }, title: { type: "string" }, image: { type: "string" } } };
    expect(thumbScoreArgs(schema, o)).toEqual({ videoId: "abc", title: "T", image: "https://x/y.jpg" });
  });
  it("image chỉ nhận object → { url }; anyOf có string → URL; schema không có title → bỏ title", () => {
    expect(thumbScoreArgs({ properties: { image: { type: "object" } } }, o)).toEqual({ videoId: "abc", image: { url: "https://x/y.jpg" } });
    expect(thumbScoreArgs({ properties: { image: { anyOf: [{ type: "string" }, { type: "object" }] } } }, o).image).toBe("https://x/y.jpg");
  });
});
