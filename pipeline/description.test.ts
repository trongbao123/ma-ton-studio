import { describe, expect, it } from "vitest";
import { AI_NOTE } from "@/lib/seo-optimize";
import { composeDescription, segmentCount, segmentsFromCues, segmentsFromText, splitBody } from "./description";

describe("mô tả YouTube", () => {
  it("số mốc 4–8 theo độ dài", () => {
    expect(segmentCount(300)).toBe(4);
    expect(segmentCount(15 * 60)).toBe(5);
    expect(segmentCount(3 * 3600)).toBe(8);
  });

  it("mốc đầu luôn 00:00, theo cue thật", () => {
    const cues = Array.from({ length: 40 }, (_, i) => ({ start: i * 30, end: i * 30 + 30, text: `câu ${i}` }));
    const s = segmentsFromCues(cues, 1200);
    expect(s[0].start).toBe(0);
    expect(s.every((x, i) => i === 0 || x.start > s[i - 1].start)).toBe(true);
    expect(s[1].text).toContain("câu");
  });

  it("chia theo chữ khi không có cue", () => {
    const s = segmentsFromText("a".repeat(1000), 900);
    expect(s.map((x) => x.start)).toEqual([0, 180, 360, 540, 720]);
  });

  it("ghép đủ mục lục, link, hashtag thiếu, ghi chú AI, ghi công nhạc; chạy lại không nhân đôi", () => {
    const d = composeDescription("Thân bài #TruyenAudio", [{ start: 0, title: "Mở đầu" }, { start: 200, title: "Mưa máu" }, { start: 4000, title: "Lật kèo" }], ["⏮ Chương 1: x"], ["#TruyenAudio", "#TienHiep"], "Nhạc nền: \"Rites\" – Kevin MacLeod");
    expect(d).toContain("⏱ MỤC LỤC\n00:00 Mở đầu\n03:20 Mưa máu\n1:06:40 Lật kèo");
    expect(d).toContain("⏮ Chương 1: x");
    expect(d.match(/#TruyenAudio/g)).toHaveLength(1);
    expect(d).toContain("#TienHiep");
    expect(d.indexOf(AI_NOTE)).toBeLessThan(d.indexOf("Nhạc nền"));
    const again = splitBody(`${d.replace(/\n\nNhạc nền:[\s\S]*$/, "")}\n\nNhạc nền: x`);
    expect(again.body).toBe("Thân bài #TruyenAudio");
    expect(again.credit).toBe("\n\nNhạc nền: x");
  });
});
