import { describe, expect, it } from "vitest";
import { LIFE_PILOT, lifeMood, lifeVoice, pilotOutline } from "./life";

describe("lifeVoice", () => {
  it("tin vai người kể trong tiêu đề trước nội dung", () => {
    expect(lifeVoice("Vợ tôi bỏ đi.", "Nuôi 3 Con Khôn Lớn, Đến Tuổi 55 Bà Mẹ Không Còn Nơi Để Về")).toBe("Sulafat");
    expect(lifeVoice("Chồng tôi mất sớm.", "Người Cha Nghèo Đến Dự Đám Cưới Con Gái")).toBe("Charon");
  });
  it("tiêu đề không rõ vai thì đoán theo nội dung", () => {
    expect(lifeVoice("Tôi mang nặng đẻ đau ba đứa.", "Hai Anh Em Tranh Nhau Mảnh Đất")).toBe("Sulafat");
  });
});

describe("lifeMood", () => {
  const mood = (i: number) => lifeMood(pilotOutline(LIFE_PILOT[i]), LIFE_PILOT[i].title);
  it("đọc dòng Cảm xúc chính của dàn ý", () => {
    expect(mood(0)).toBe("sad"); // Xót xa, bất công
    expect(mood(1)).toBe("mystery"); // Phản bội, bất ngờ
    expect(mood(4)).toBe("warm"); // Tử tế, ấm lòng
    expect(mood(9)).toBe("warm"); // Hy vọng
  });
  it("không có cảm xúc → buồn", () => expect(lifeMood("", "")).toBe("sad"));
});
