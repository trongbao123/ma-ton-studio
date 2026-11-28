import { describe, expect, it } from "vitest";
import { reviewPrompt, XIANXIA_OPENING_CHECK } from "./editor";
import { HISTORY_OPENING_CHECK, HISTORY_OPENING_RULES, historyWriterSystem } from "./history";
import { LIFE_OPENING_CHECK } from "./life";
import { openingCheckFor } from "./service";

describe("chấm mở đầu theo thể loại", () => {
  it("lịch sử / chuyện đời / tu tiên mỗi thể loại một bộ luật", () => {
    expect(openingCheckFor({ genre: "Lịch sử" }, true)).toBe(HISTORY_OPENING_CHECK);
    expect(openingCheckFor({ genre: "Chuyện đời" }, false)).toBe(LIFE_OPENING_CHECK);
    expect(openingCheckFor({ genre: "Tiên hiệp" }, false)).toBe(XIANXIA_OPENING_CHECK);
  });
});

describe("mở đầu kịch bản lịch sử", () => {
  it("biên tập viên chấm cả giữ chân lẫn đúng sự thật, không lẫn luật bàn tay vàng", () => {
    const p = reviewPrompt("Đêm 30 Tết.", HISTORY_OPENING_CHECK);
    expect(p.system).toMatch(/lịch sử/);
    expect(p.prompt).not.toMatch(/bàn tay vàng/);
    expect(HISTORY_OPENING_RULES.some((r) => /hồ sơ tư liệu/.test(r))).toBe(true);
  });

  it("cấm mở kiểu sách giáo khoa", () => {
    expect(HISTORY_OPENING_RULES[0]).toMatch(/KHÔNG mở bằng năm sinh, tiểu sử/);
  });

  it("đúng một lời mời đăng ký, ở cuối hồi 1", () => {
    const cta = historyWriterSystem().split("\n").filter((l) => /đăng ký kênh/.test(l));
    expect(cta).toHaveLength(1);
    expect(cta[0]).toMatch(/cuối HỒI 1/);
  });
});
