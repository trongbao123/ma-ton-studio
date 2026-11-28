import { describe, expect, it } from "vitest";
import type { Chapter } from "@/db/schema";
import { historySourcesBlock, pickThumbnailImage } from "./history-meta";
import type { ArtImage } from "./scene-art";

const art = (o: Partial<ArtImage> = {}): ArtImage => ({ file: "a.jpg", title: "File:A.jpg", url: "u", license: "Public domain", artist: "X", synthetic: false, ...o });
const chapter = (outline: string): Pick<Chapter, "outline"> => ({ outline });

describe("chọn ảnh thumbnail cho video lịch sử", () => {
  it("ưu tiên ảnh tư liệu thật, không dùng ảnh AI khi có ảnh thật", () => {
    const got = pickThumbnailImage([art({ file: "ai.jpg", synthetic: true }), art({ file: "thuc.jpg", synthetic: false })]);
    expect(got).toBe("thuc.jpg");
  });

  it("không có ảnh thật nào → lùi về ảnh AI đầu tiên", () => {
    expect(pickThumbnailImage([art({ file: "ai.jpg", synthetic: true })])).toBe("ai.jpg");
  });

  it("không có ảnh nào → null", () => {
    expect(pickThumbnailImage([])).toBeNull();
  });
});

describe("nguồn + ghi công nối vào mô tả video lịch sử (do code tự ghi, không để AI bịa)", () => {
  it("có bài Wikipedia trong outline → nối dòng nguồn", () => {
    const block = historySourcesBlock({ series: {} as never, chapter: chapter("Mở ở đêm 30 Tết.\nWikipedia: Battle of Ngọc Hồi-Đống Đa") as Chapter, images: [], musicFiles: [] });
    expect(block).toContain('Wikipedia — "Battle of Ngọc Hồi-Đống Đa"');
  });

  it("outline không có dòng Wikipedia → không bịa nguồn", () => {
    const block = historySourcesBlock({ series: {} as never, chapter: chapter("Không có dòng nguồn.") as Chapter, images: [], musicFiles: [] });
    expect(block).not.toMatch(/Wikipedia/);
  });

  it("ảnh tư liệu thật → ghi công kèm giấy phép, ảnh AI không bắt buộc ghi công riêng", () => {
    const block = historySourcesBlock({
      series: {} as never,
      chapter: chapter("Wikipedia: X") as Chapter,
      images: [art({ title: "File:Trận.jpg", license: "CC BY-SA 4.0", artist: "Ai đó" })],
      musicFiles: [],
    });
    expect(block).toMatch(/File:Trận\.jpg/);
    expect(block).toMatch(/CC BY-SA 4\.0/);
  });

  it("có nhạc dùng → ghi công Kevin MacLeod kèm tên bài", () => {
    const block = historySourcesBlock({ series: {} as never, chapter: chapter("Wikipedia: X") as Chapter, images: [], musicFiles: ["pipeline/music/Rites.mp3"] });
    expect(block).toMatch(/Rites/);
    expect(block).toMatch(/Kevin MacLeod/);
  });

  it("không ảnh không nhạc không nguồn → chuỗi rỗng, không có đoạn rác", () => {
    expect(historySourcesBlock({ series: {} as never, chapter: chapter("Không có gì.") as Chapter, images: [], musicFiles: [] })).toBe("");
  });
});
