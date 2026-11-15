import { describe, expect, it } from "vitest";
import { chooseTitle } from "./vidiq";

describe("chooseTitle", () => {
  it("lấy điểm vidIQ cao nhất, KHÔNG gắn từ khóa vào tiêu đề giật tít", () => {
    const r = chooseTitle([
      { title: "Truyện audio: Lâm Uyên thức tỉnh Ám Ảnh Ma Đồng", score: 84 },
      { title: "Thanh niên quá ngông đòi cân cả lò team địch và cái kết ăn hành ngập mồm", score: 95 },
    ]);
    expect(r).toEqual({ title: "Thanh niên quá ngông đòi cân cả lò team địch và cái kết ăn hành ngập mồm", score: 95 });
  });
  it("bằng điểm thì giữ phương án đứng trước", () => {
    expect(chooseTitle([{ title: "A", score: 90 }, { title: "B", score: 90 }]).title).toBe("A");
  });
  it("vidIQ không chấm được thì lấy phương án đầu", () => {
    expect(chooseTitle([{ title: "A", score: null }, { title: "B", score: null }]).title).toBe("A");
  });
});
