import { describe, expect, it } from "vitest";
import { buildTrendsPrompt, freshInsights, parseVideos, seoHints, trendsBrief, type TrendInsights, type TrendsData, type TrendVideo } from "./trends";

const insights: TrendInsights = {
  summary: "s",
  hotTopics: [{ topic: "Trùng sinh báo thù", why: "nhiều view", evidence: "video A" }],
  titlePatterns: ["Số + cảnh giới"],
  thumbnailPatterns: ["Mặt cận cảnh, nền đỏ"],
  hooks: ["Mở đầu bằng cái chết"],
  audienceWants: ["Nhân vật chính không thánh mẫu"],
  risingKeywords: [],
  actions: [],
};
const NOW = Date.parse("2026-11-10T00:00:00Z");
const data = (scannedAt: string, i: TrendInsights | null = insights): TrendsData => ({ scannedAt, raw: { trending: [], outliers: [] }, insights: i });

describe("freshInsights", () => {
  it("còn hạn trong 7 ngày", () => {
    expect(freshInsights(data("2026-11-04T00:00:00Z"), NOW)).toBe(insights);
  });
  it("quá hạn / không có insight / không có dữ liệu → null", () => {
    expect(freshInsights(data("2026-11-02T00:00:00Z"), NOW)).toBeNull();
    expect(freshInsights(data("2026-11-09T00:00:00Z", null), NOW)).toBeNull();
    expect(freshInsights(null, NOW)).toBeNull();
    expect(freshInsights(data("hỏng"), NOW)).toBeNull();
  });
});

describe("trendsBrief", () => {
  it("gom 4 mục và không quá giới hạn", () => {
    const brief = trendsBrief(insights)!;
    expect(brief).toContain("Trùng sinh báo thù");
    expect(brief).toContain("Mở đầu bằng cái chết");
    const long = { ...insights, hotTopics: Array.from({ length: 4 }, (_, n) => ({ topic: "x".repeat(400) + n, why: "y".repeat(400), evidence: "" })) };
    expect(trendsBrief(long)!.length).toBeLessThanOrEqual(1200);
  });
  it("null khi không có insight", () => {
    expect(trendsBrief(null)).toBeNull();
  });
});

describe("seoHints", () => {
  it("lấy mẫu tiêu đề + thumbnail, rỗng thì null", () => {
    expect(seoHints(insights)).toEqual({ titlePatterns: ["Số + cảnh giới"], thumbnailPatterns: ["Mặt cận cảnh, nền đỏ"] });
    expect(seoHints({ ...insights, titlePatterns: [], thumbnailPatterns: [] })).toBeNull();
    expect(seoHints(null)).toBeNull();
  });
});

describe("parseVideos", () => {
  it("đọc JSON lồng nhau, dựng url + thumbnail từ videoId", () => {
    const text = JSON.stringify({ videos: [{ title: "Tu tiên", channelTitle: "Kênh A", viewCount: "12,000", videoId: "abcdefghijk", outlierScore: 4.2 }] });
    expect(parseVideos(text)).toEqual([
      { title: "Tu tiên", channel: "Kênh A", views: 12000, vph: null, outlierScore: 4.2, publishedAt: null, durationSec: null, url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg" },
    ]);
  });
  it("đọc bảng markdown theo tên cột", () => {
    const text = "| title | channel | views | publishedAt |\n|---|---|---|---|\n| Tiên hiệp hay | Kênh B | 5000 | 2026-11-01 |";
    const [v] = parseVideos(text);
    expect(v).toMatchObject({ title: "Tiên hiệp hay", channel: "Kênh B", views: 5000, publishedAt: "2026-11-01" });
  });
  it("văn bản lạ → rỗng", () => {
    expect(parseVideos("không có gì")).toEqual([]);
  });
});

describe("buildTrendsPrompt", () => {
  const v = (n: number): TrendVideo => ({ title: `Video ${n}`, channel: "K", views: 1500, vph: null, outlierScore: null, publishedAt: null, url: null, thumbnail: null });
  it("cắt số video và độ dài văn bản", () => {
    const out = buildTrendsPrompt({ trending: Array.from({ length: 30 }, (_, n) => v(n)), outliers: [], texts: [{ label: "KW", text: "k".repeat(5000) }] }, 5, 100);
    expect(out.match(/- "Video/g)).toHaveLength(5);
    expect(out).toContain("2K view");
    expect(out.length).toBeLessThan(700);
  });
});
