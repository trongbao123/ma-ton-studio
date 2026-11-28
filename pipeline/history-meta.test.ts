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
    expect(pickThumbnailImage([art({ file: "ai.jpg", synthetic: true }), art({ file: "thuc.jpg", synthetic: false })])?.file).toBe("thuc.jpg");
  });
  it("không có ảnh thật nào → lùi về ảnh AI đầu tiên", () => {
    expect(pickThumbnailImage([art({ file: "ai.jpg", synthetic: true })])?.file).toBe("ai.jpg");
  });
  it("không có ảnh nào → null", () => {
    expect(pickThumbnailImage([])).toBeNull();
  });
});

describe("truncateToBytes — cắt theo byte UTF-8 một lượt, không theo số ký tự", () => {
  it("chuỗi đã dưới ngân sách thì giữ nguyên", () => {
    expect(truncateToBytes("abc", 10)).toBe("abc");
  });
  it("cắt chuỗi tiếng Việt có dấu vẫn ra chuỗi hợp lệ, không vượt ngân sách byte", () => {
    const text = "Đêm 30 Tết, quân Tây Sơn vượt sông tiến về Ngọc Hồi".repeat(5);
    const cut = truncateToBytes(text, 50);
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(50);
    // Chuỗi ra phải decode lại được, không còn ký tự thay thế U+FFFD do cắt giữa byte đa byte.
    expect(cut).not.toContain("�");
  });
  it("cắt đúng ngay ranh giới một ký tự nhiều byte (không lẹm giữa ký tự)", () => {
    // "Đ" (2 byte UTF-8: 0xC4 0x90) + "A" (1 byte) — ngân sách 2 byte phải cắt trước "Đ", không cắt giữa nó.
    expect(truncateToBytes("ĐA", 1)).toBe("");
    expect(truncateToBytes("ĐA", 2)).toBe("Đ");
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

describe("khối ghi công ảnh — KHÔNG bỏ ghi công, ảnh không vừa trả về ở overflow để đăng bình luận", () => {
  const many = Array.from({ length: 50 }, (_, i) => art({ title: `File:Anh${i}.jpg`, url: `u${i}` }));

  it("đủ ngân sách thì liệt kê hết trong mô tả, không có ảnh nào ở overflow", () => {
    const { block, overflow } = artCreditBlock(many.slice(0, 2), 2000);
    expect(block).toContain("Anh0.jpg");
    expect(block).toContain("Anh1.jpg");
    expect(overflow).toEqual([]);
  });

  it("danh sách dài vượt ngân sách → phần trong mô tả không vượt ngân sách, phần dư nằm ở overflow — KHÔNG mất ảnh nào", () => {
    const budget = 300;
    const { block, overflow } = artCreditBlock(many, budget);
    expect(Buffer.byteLength(block, "utf8")).toBeLessThanOrEqual(budget);
    expect(block).not.toMatch(/ảnh khác/); // không dùng kiểu tóm lược "... và N ảnh khác" nữa
    expect(overflow.length).toBeGreaterThan(0);
    expect(overflow.length + many.filter((img) => block.includes(img.title)).length).toBe(many.length);
  });

  it("mỗi dòng overflow có đủ tên ảnh, tác giả, giấy phép, đường dẫn", () => {
    const { overflow } = artCreditBlock(many, 1);
    expect(overflow[0]).toMatch(/File:Anh\d+\.jpg/);
    expect(overflow[0]).toMatch(/X/);
    expect(overflow[0]).toMatch(/Public domain/);
    expect(overflow[0]).toMatch(/u\d+/);
  });

  it("ngân sách quá nhỏ cho cả 1 ảnh → mô tả rỗng, TẤT CẢ ảnh rơi vào overflow (không mất ghi công)", () => {
    const { block, overflow } = artCreditBlock(many, 1);
    expect(block).toBe("");
    expect(overflow).toHaveLength(many.length);
  });

  it("có ảnh AI xen với ảnh thật → vẫn giữ dòng ghi chú 'Minh họa' trong mô tả dù ảnh thật bị đẩy hết sang overflow", () => {
    const images = [...many, art({ synthetic: true, file: "ai.jpg" })];
    const { block } = artCreditBlock(images, 160);
    expect(block).toMatch(/Minh họa/);
  });
});

describe("mô tả video lịch sử — thứ tự Wikipedia → nhạc (CC BY) → ảnh, tổng luôn ≤ 4900 byte, không bỏ ghi công", () => {
  it("thứ tự đúng: tóm tắt AI, rồi nguồn Wikipedia, rồi ghi công nhạc, rồi ghi công ảnh", () => {
    const { description } = buildHistoryDescription("Tóm tắt video.", video({ images: [art()], musicFiles: ["pipeline/music/Rites.mp3"] }));
    const iWiki = description.indexOf("Wikipedia");
    const iMusic = description.indexOf("Kevin MacLeod");
    const iArt = description.indexOf("File:A.jpg");
    expect(iWiki).toBeGreaterThan(-1);
    expect(iWiki).toBeLessThan(iMusic);
    expect(iMusic).toBeLessThan(iArt);
  });

  it("outline không có dòng Wikipedia → không bịa nguồn", () => {
    const { description } = buildHistoryDescription("Tóm tắt.", video({ outline: "Không có dòng nguồn." }));
    expect(description).not.toMatch(/Wikipedia/);
  });

  it("có nhạc dùng → luôn giữ ghi công Kevin MacLeod dù mô tả AI rất dài", () => {
    const { description } = buildHistoryDescription("Từ dài. ".repeat(2000), video({ musicFiles: ["pipeline/music/Rites.mp3"] }));
    expect(description).toMatch(/Kevin MacLeod/);
    expect(description).toMatch(/Rites/);
  });

  it("mô tả AI + ghi công vượt 5000 byte (trường hợp vốn gây YouTube từ chối upload) → tổng cuối luôn ≤ 4900 byte, ảnh thừa chuyển sang overflowCredits không mất ghi công", () => {
    const manyImages = Array.from({ length: 300 }, (_, i) => art({ title: `File:Trận đánh ${i}.jpg`, url: `https://commons.wikimedia.org/wiki/Tran_${i}` }));
    const { description, overflowCredits } = buildHistoryDescription(
      "Một đoạn tóm tắt dài vừa phải cho video lịch sử. ".repeat(10),
      video({ images: manyImages, musicFiles: ["pipeline/music/Rites.mp3", "pipeline/music/Darkest Child.mp3"] }),
    );
    expect(Buffer.byteLength(description, "utf8")).toBeLessThanOrEqual(4900);
    expect(overflowCredits.length).toBeGreaterThan(0);
  });

  it("không ảnh, không nhạc, không nguồn → chỉ còn tóm tắt AI, không có đoạn rác, không overflow", () => {
    const { description, overflowCredits } = buildHistoryDescription("Tóm tắt.", video({ outline: "Không có gì." }));
    expect(description).toBe("Tóm tắt.");
    expect(overflowCredits).toEqual([]);
  });
});
