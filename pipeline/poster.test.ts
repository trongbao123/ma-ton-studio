import { describe, expect, it } from "vitest";
import { posterFilter, posterTitle } from "./render";

describe("thumbnail kiểu poster", () => {
  it("tên truyện ngắn: phần trước dấu hai chấm, in hoa", () => {
    expect(posterTitle("Thần Ma Táng Cổ: Thôn Thiên Lục")).toBe("THẦN MA TÁNG CỔ");
    expect(posterTitle("Ma Tôn Trùng Sinh")).toBe("MA TÔN TRÙNG SINH");
  });
  it("có lớp chuyển màu mượt (geq), tên truyện font Playfair, ruy băng tập và nhãn thời lượng", () => {
    const f = posterFilter(["CẢ PHỐ", "QUỲ RẠP"], 150, "FULL 1H40", { title: "THẦN MA TÁNG CỔ", ribbon: "TẬP 4 · CHƯƠNG 10–12" });
    expect(f).toMatch(/geq=.*a='.*clip\(/);
    expect(f).toContain("PlayfairDisplay-Black.ttf");
    expect(f).toContain("THẦN MA TÁNG CỔ");
    expect(f).toContain("TẬP 4 · CHƯƠNG 10–12");
    expect(f).toContain("FULL 1H40");
    expect(f).not.toMatch(/drawbox=x=iw\*0\.42/);
  });
});
