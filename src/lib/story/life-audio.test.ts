import { describe, expect, it } from "vitest";
import { lifeVoice } from "./life";

describe("lifeVoice", () => {
  it("tin vai người kể trong tiêu đề trước nội dung", () => {
    expect(lifeVoice("Vợ tôi bỏ đi.", "Nuôi 3 Con Khôn Lớn, Đến Tuổi 55 Bà Mẹ Không Còn Nơi Để Về")).toBe("Gacrux");
    expect(lifeVoice("Chồng tôi mất sớm.", "Người Cha Nghèo Đến Dự Đám Cưới Con Gái")).toBe("Algenib");
  });
  it("tiêu đề không rõ vai thì đoán theo nội dung", () => {
    expect(lifeVoice("Tôi mang nặng đẻ đau ba đứa.", "Hai Anh Em Tranh Nhau Mảnh Đất")).toBe("Gacrux");
  });
});

import { cleanTags } from "@/lib/youtube-tags";
describe("cleanTags chuyện đời", () => {
  const ai = ["Sau 20 Năm Chung Sống Người Vợ Phát Hiện Bí Mật Trong Điện Thoại Chồng", "truyện tu tiên", "xuyên không", "truyện audio cảm động", "chuyện vợ chồng"];
  it("bộ tag kênh chuyện đời đứng đầu, bỏ tag tu tiên và tag nguyên tiêu đề", () => {
    const t = cleanTags(ai, true);
    expect(t.slice(0, 2)).toEqual(["audio truyện", "truyện audio"]);
    expect(t.join("|")).not.toMatch(/tu tiên|tiên hiệp|xuyên không|Sau 20 Năm/);
    expect(t).toContain("chuyện vợ chồng");
  });
  it("kênh gốc giữ nguyên bộ tu tiên", () => expect(cleanTags(ai)).toContain("truyện tu tiên"));
});
