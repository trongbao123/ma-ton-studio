import { describe, expect, it } from "vitest";
import type { Chapter } from "@/db/schema";
import { artCreditBlock, buildHistoryDescription, dedupeArtImages, pickThumbnailImage, truncateToBytes } from "./history-meta";
import type { ArtImage } from "./scene-art";

const art = (o: Partial<ArtImage> = {}): ArtImage => ({ file: "a.jpg", title: "File:A.jpg", url: "u", license: "Public domain", artist: "X", synthetic: false, ...o });
const chapter = (outline: string): Pick<Chapter, "outline"> => ({ outline });
const video = (o: { images?: ArtImage[]; musicFiles?: string[]; outline?: string } = {}) => ({
  chapter: chapter(o.outline ?? "Wikipedia: Battle of Ngọc Hồi-Đống Đa") as Chapter,
  images: o.images ?? [],
  musicFiles: o.musicFiles ?? [],
});

describe("chọn ảnh thumbnail cho video lịch sử", () => {
  it("ưu tiên ảnh tư liệu thật, không dùng ảnh AI khi có ảnh thật", () => {
    expect(pickThumbnailImage([art({ file: "ai.jpg", synthetic: true }), art({ file: "thuc.jpg", synthetic: false })])).toBe("thuc.jpg");
  });
  it("không có ảnh thật nào → lùi về ảnh AI đầu tiên", () => {
    expect(pickThumbnailImage([art({ file: "ai.jpg", synthetic: true })])).toBe("ai.jpg");
  });
  it("không có ảnh nào → null", () => {
    expect(pickThumbnailImage([])).toBeNull();
  });
});

describe("truncateToBytes — cắt theo byte UTF-8, không theo số ký tự", () => {
  it("chuỗi đã dưới ngân sách thì giữ nguyên", () => {
    expect(truncateToBytes("abc", 10)).toBe("abc");
  });
  it("cắt chuỗi tiếng Việt có dấu vẫn ra chuỗi hợp lệ, không vượt ngân sách byte", () => {
    const text = "Đêm 30 Tết, quân Tây Sơn vượt sông tiến về Ngọc Hồi".repeat(5);
    const cut = truncateToBytes(text, 50);
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(50);
  });
  it("ngân sách 0 hoặc âm → chuỗi rỗng", () => {
    expect(truncateToBytes("abc", 0)).toBe("");
    expect(truncateToBytes("abc", -5)).toBe("");
  });
});

describe("khử trùng ảnh ghi công — storyboard cắt một cảnh thành nhiều shot hay dùng lại cùng ảnh", () => {
  it("ảnh cùng title+url chỉ còn 1 bản", () => {
    const images = [art({ title: "File:A.jpg", url: "u1" }), art({ title: "File:A.jpg", url: "u1" }), art({ title: "File:B.jpg", url: "u2" })];
    expect(dedupeArtImages(images)).toHaveLength(2);
  });
});

describe("khối ghi công ảnh — cắt số ảnh cho vừa ngân sách byte", () => {
  const many = Array.from({ length: 50 }, (_, i) => art({ title: `File:Anh${i}.jpg`, url: `u${i}` }));

  it("đủ ngân sách thì liệt kê hết, không thêm dòng '... và N ảnh khác'", () => {
    const block = artCreditBlock(many.slice(0, 2), 2000);
    expect(block).not.toMatch(/ảnh khác/);
    expect(block).toContain("Anh0.jpg");
    expect(block).toContain("Anh1.jpg");
  });

  it("danh sách dài vượt ngân sách → cắt bớt + thêm dòng '... và N ảnh khác', và KHÔNG vượt ngân sách", () => {
    const budget = 300;
    const block = artCreditBlock(many, budget);
    expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(budget);
    expect(block).toMatch(/và \d+ ảnh khác/);
  });

  it("ngân sách quá nhỏ cho cả 1 ảnh → về chuỗi rỗng, không ném lỗi", () => {
    expect(artCreditBlock(many, 1)).toBe("");
  });

  it("có ảnh AI xen với ảnh thật → vẫn giữ dòng ghi chú 'Minh họa' dù ảnh thật bị cắt hết", () => {
    const images = [...many, art({ synthetic: true, file: "ai.jpg" })];
    const block = artCreditBlock(images, 160);
    expect(block).toMatch(/Minh họa/);
  });

  it("ngân sách quá nhỏ cho cả dòng ghi chú 'Minh họa' → về chuỗi rỗng, không ném lỗi", () => {
    const images = [...many, art({ synthetic: true, file: "ai.jpg" })];
    expect(artCreditBlock(images, 1)).toBe("");
  });
});

describe("mô tả video lịch sử — thứ tự Wikipedia → nhạc (CC BY) → ảnh, tổng luôn ≤ 4900 byte", () => {
  it("thứ tự đúng: tóm tắt AI, rồi nguồn Wikipedia, rồi ghi công nhạc, rồi ghi công ảnh", () => {
    const d = buildHistoryDescription("Tóm tắt video.", video({ images: [art()], musicFiles: ["pipeline/music/Rites.mp3"] }));
    const iWiki = d.indexOf("Wikipedia");
    const iMusic = d.indexOf("Kevin MacLeod");
    const iArt = d.indexOf("File:A.jpg");
    expect(iWiki).toBeGreaterThan(-1);
    expect(iWiki).toBeLessThan(iMusic);
    expect(iMusic).toBeLessThan(iArt);
  });

  it("outline không có dòng Wikipedia → không bịa nguồn", () => {
    const d = buildHistoryDescription("Tóm tắt.", video({ outline: "Không có dòng nguồn." }));
    expect(d).not.toMatch(/Wikipedia/);
  });

  it("có nhạc dùng → luôn giữ ghi công Kevin MacLeod dù mô tả AI rất dài", () => {
    const d = buildHistoryDescription("Từ dài. ".repeat(2000), video({ musicFiles: ["pipeline/music/Rites.mp3"] }));
    expect(d).toMatch(/Kevin MacLeod/);
    expect(d).toMatch(/Rites/);
  });

  it("mô tả AI + ghi công vượt 5000 byte (trường hợp vốn gây YouTube từ chối upload) → tổng cuối luôn ≤ 4900 byte", () => {
    const manyImages = Array.from({ length: 300 }, (_, i) => art({ title: `File:Trận đánh ${i}.jpg`, url: `https://commons.wikimedia.org/wiki/Tran_${i}` }));
    const d = buildHistoryDescription("Một đoạn tóm tắt dài vừa phải cho video lịch sử. ".repeat(10), video({ images: manyImages, musicFiles: ["pipeline/music/Rites.mp3", "pipeline/music/Darkest Child.mp3"] }));
    expect(Buffer.byteLength(d, "utf8")).toBeLessThanOrEqual(4900);
  });

  it("không ảnh, không nhạc, không nguồn → chỉ còn tóm tắt AI, không có đoạn rác", () => {
    const d = buildHistoryDescription("Tóm tắt.", video({ outline: "Không có gì." }));
    expect(d).toBe("Tóm tắt.");
  });
});
