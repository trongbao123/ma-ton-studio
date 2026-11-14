import { describe, expect, it } from "vitest";
import type { Series } from "@/db/schema";
import { seriesSettingsFrom, tropeOf, TROPES } from "./tropes";

describe("tropes", () => {
  it("có đủ 4 mô-típ, key và thể loại không trùng", () => {
    expect(TROPES.map((t) => t.key)).toEqual(["trungsinh", "xuyenkhong", "hethong", "giaunghe"]);
    expect(new Set(TROPES.map((t) => t.genre)).size).toBe(4);
  });
  it("tropeOf báo lỗi rõ khi sai key", () => {
    expect(tropeOf(" hethong ").genre).toContain("hệ thống");
    expect(() => tropeOf("abc")).toThrow(/trungsinh, xuyenkhong, hethong, giaunghe/);
  });
  it("copy cấu hình vận hành từ bộ mẫu, luôn bật autopilot, không copy nội dung", () => {
    const tpl = {
      id: 4, title: "Cũ", genre: "tiên hiệp", premise: "p", bible: "b", style: "s", targetWords: 5000, autopilot: false,
      autoApprove: true, chaptersPerDay: 3, episodeChapters: 3, ttsVoice: "Charon", makeShort: true, autoPublish: true, voiceStyle: "trầm", createdAt: new Date(),
    } as Series;
    const s = seriesSettingsFrom(tpl);
    expect(s).toMatchObject({ autopilot: true, episodeChapters: 3, ttsVoice: "Charon", chaptersPerDay: 3, targetWords: 5000 });
    expect(s).not.toHaveProperty("bible");
    expect(s).not.toHaveProperty("title");
    expect(seriesSettingsFrom(undefined).autopilot).toBe(true);
  });
});
