import { describe, expect, it } from "vitest";
import type { Chapter, Series } from "@/db/schema";
import {
  HISTORY_PART_WORDS,
  HISTORY_PILOT,
  historyChapterPrompt,
  historyIsFinalPart,
  isSensitiveTopic,
  topicOutline,
  wikiTitleOf,
} from "./history";

const series = { id: 1, title: "Sử Ký Kể Chuyện", genre: "Lịch sử", bible: "Kênh lịch sử", style: "" } as Series;
const chapter = { id: 1, number: 1, title: HISTORY_PILOT[0].title, outline: topicOutline(HISTORY_PILOT[0]) } as Chapter;

describe("đề tài kênh lịch sử", () => {
  it("20 đề tài khởi đầu, không đề tài nào nhạy cảm, đều có dòng Wikipedia", () => {
    expect(HISTORY_PILOT).toHaveLength(20);
    for (const t of HISTORY_PILOT) {
      expect(isSensitiveTopic(`${t.title}\n${topicOutline(t)}`)).toBe(false);
      expect(wikiTitleOf(topicOutline(t))).toBe(t.wiki);
    }
    expect(wikiTitleOf(topicOutline(HISTORY_PILOT[0]))).toBe("Battle of Ngọc Hồi-Đống Đa");
    expect(wikiTitleOf("không có")).toBeNull();
  });

  it("lọc đề tài nhạy cảm: sau 1945, biển đảo, biên giới 1979, xung đột hiện đại", () => {
    expect(isSensitiveTopic("Trận Điện Biên Phủ 1954")).toBe(true);
    expect(isSensitiveTopic("Hải chiến Hoàng Sa")).toBe(true);
    expect(isSensitiveTopic("Chiến tranh biên giới 1979")).toBe(true);
    expect(isSensitiveTopic("xung dot Gaza")).toBe(true);
    expect(isSensitiveTopic("Trận Bạch Đằng 1288")).toBe(false);
    expect(isSensitiveTopic("Đắm tàu Titanic 1912")).toBe(false);
  });
});

describe("prompt viết kịch bản lịch sử", () => {
  it("đưa nguyên hồ sơ vào prompt, có luật không hư cấu, không dùng luật hư cấu của chuyện đời", () => {
    const p = historyChapterPrompt(series, chapter, "HỒ SƠ MẪU 938");
    expect(p.prompt).toContain("HỒ SƠ MẪU 938");
    expect(p.prompt).toContain(String(HISTORY_PART_WORDS));
    expect(`${p.system}\n${p.prompt}`).toMatch(/không hư cấu/i);
    expect(p.system).not.toContain("HOÀN TOÀN HƯ CẤU");
  });

  it("lượt cuối khi phần còn thiếu vừa một lượt", () => {
    expect(historyIsFinalPart(5000)).toBe(true);
    expect(historyIsFinalPart(2500)).toBe(false);
  });
});
