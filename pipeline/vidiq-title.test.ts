import { describe, expect, it } from "vitest";
import { chooseTitle } from "./vidiq";

const kws = ["truyện audio", "audio tiên hiệp", "truyện tu tiên"];

describe("chooseTitle", () => {
  it("ưu tiên tiêu đề có từ khóa tìm thật nếu điểm không kém quá 8", () => {
    const r = chooseTitle(
      [
        { title: "Lâm Uyên thức tỉnh Ám Ảnh Ma Đồng: Cuộc săn sinh tử bắt đầu!", score: 91 },
        { title: "Truyện audio: Lâm Uyên thức tỉnh Ám Ảnh Ma Đồng giữa cuộc săn sinh tử", score: 84 },
      ],
      kws,
    );
    expect(r).toEqual({ title: "Truyện audio: Lâm Uyên thức tỉnh Ám Ảnh Ma Đồng giữa cuộc săn sinh tử", score: 84 });
  });
  it("khớp có dấu — tiêu đề không dấu không tính là có từ khóa", () => {
    const r = chooseTitle([{ title: "Truyen tu tien: Lâm Uyên nổi giận", score: 90 }], kws);
    expect(r.title).toBe("Truyện audio: Truyen tu tien: Lâm Uyên nổi giận");
  });
  it("tiêu đề có từ khóa kém quá xa thì gắn từ khóa vào tiêu đề điểm cao nhất, bỏ trống điểm", () => {
    const r = chooseTitle(
      [
        { title: "Bí mật kinh hoàng trong lò rèn cổ", score: 92 },
        { title: "Truyện tu tiên chương 2", score: 60 },
      ],
      kws,
    );
    expect(r).toEqual({ title: "Truyện audio: Bí mật kinh hoàng trong lò rèn cổ", score: null });
  });
  it("không có dữ liệu từ khóa thì lấy điểm cao nhất như cũ", () => {
    expect(chooseTitle([{ title: "A dài dài", score: 70 }, { title: "B dài dài", score: 80 }], []).title).toBe("B dài dài");
  });
});
