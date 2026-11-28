import { describe, expect, it, vi } from "vitest";
import { polishOpening, reviewPrompt, rewriteOpeningPrompt, type Ai } from "./editor";
import { LIFE_EXEMPLAR, LIFE_OPENING_CHECK, LIFE_OPENING_RULES, LIFE_OPENINGS, LIFE_PACING } from "./life";

// 28/11/2026: video chuyện đời mở "Tôi năm nay năm mươi tám tuổi" mất ~60% người xem trong 1–2 phút đầu (giữ chân 12,8%).
const AGE_OPENER = /^Tôi năm nay|^Tôi tên/;

describe("mở đầu chuyện đời không kéo AI về kiểu tự giới thiệu", () => {
  it("không kiểu mở đầu nào bảo mở bằng tuổi", () => {
    for (const o of LIFE_OPENINGS) expect(o).not.toMatch(/Tôi năm nay/);
  });

  it("đoạn văn mẫu (AI hay chép câu đầu) không mở bằng tuổi", () => {
    expect(LIFE_EXEMPLAR).not.toMatch(AGE_OPENER);
  });

  it("nhịp 20 giây đầu cấm rõ câu đầu là tuổi/tên", () => {
    expect(LIFE_PACING[0]).toMatch(/CẤM câu đầu là tuổi/);
  });

  it("có đúng một lời mời đăng ký giữa truyện, không ở đầu", () => {
    const cta = LIFE_PACING.filter((r) => /đăng ký kênh/.test(r));
    expect(cta).toHaveLength(1);
    expect(cta[0]).toMatch(/cuối HỒI 2/);
  });
});

describe("biên tập viên AI chấm mở đầu chuyện đời", () => {
  const base = { system: "sys", prompt: "viết truyện" };

  it("chấm theo luật chuyện đời, vai biên tập chuyện đời — không lẫn luật bàn tay vàng", () => {
    const p = reviewPrompt("Câu mở.", LIFE_OPENING_CHECK);
    expect(p.system).toMatch(/chuyện đời/);
    for (const [i, r] of LIFE_OPENING_RULES.entries()) expect(p.prompt).toContain(`${i}. ${r}`);
    expect(p.prompt).not.toMatch(/bàn tay vàng/);
  });

  it("viết lại chỉ nêu luật chuyện đời bị hỏng", () => {
    const p = rewriteOpeningPrompt(base, "Tôi năm nay năm mươi tám tuổi.", [0], LIFE_OPENING_CHECK);
    expect(p.prompt).toContain(LIFE_OPENING_RULES[0]);
    expect(p.prompt).not.toContain(LIFE_OPENING_RULES[1]);
  });

  it("mở bằng tuổi bị trượt → viết lại phần mở, giữ thân truyện", async () => {
    const generateJson = vi.fn()
      .mockResolvedValueOnce({ pass: false, failed: [0], note: "mở bằng tuổi" })
      .mockResolvedValueOnce({ pass: true, failed: [], note: "" });
    const ai: Ai = { generateJson, generateText: vi.fn().mockResolvedValue("Ngày chôn chồng xong, tôi mới biết ông ấy còn một đứa con.") } as unknown as Ai;
    // Đoạn mở đủ 300 từ (splitOpening gom tới 300 từ) để phần sau là thân truyện.
    const opening = `Tôi năm nay năm mươi tám tuổi. ${"chữ ".repeat(300).trim()}`;
    const r = await polishOpening(`${opening}\n\nthân truyện`, base, ai, LIFE_OPENING_CHECK);
    expect(r).toEqual({ content: "Ngày chôn chồng xong, tôi mới biết ông ấy còn một đứa con.\n\nthân truyện", warning: null });
    expect(generateJson.mock.calls[0][0].system).toMatch(/chuyện đời/);
  });
});
