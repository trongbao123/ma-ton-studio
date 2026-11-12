import { describe, expect, it, vi } from "vitest";
import { QuotaExhaustedError } from "@/lib/ai/gemini";
import { polishOpening, type Ai, replaceOpening, reviewPrompt, rewriteOpeningPrompt, splitOpening } from "./editor";
import { OPENING_RULES, wordCount } from "./prompts";

const para = (n: number) => Array(n).fill("từ").join(" ");
const base = { system: "S", prompt: "P" };
const chapter = `${para(320)}\n\nthân chương`;

/** AI giả: chấm theo danh sách kết quả lần lượt; viết lại trả "mở đầu mới N". */
function fakeAi(reviews: Array<{ pass: boolean; failed: number[] } | Error>) {
  let r = 0;
  let w = 0;
  const fake = {
    generateJson: vi.fn(async <T,>(): Promise<T> => {
      const x = reviews[Math.min(r++, reviews.length - 1)];
      if (x instanceof Error) throw x;
      return { ...x, note: "" } as T;
    }),
    generateText: vi.fn(async () => `mở đầu mới ${++w}`),
  };
  return fake as typeof fake & Ai;
}

describe("splitOpening", () => {
  it("gom đoạn tới ≥300 từ", () => {
    const { opening, rest } = splitOpening([para(200), para(150), para(100)].join("\n\n"));
    expect(wordCount(opening)).toBe(350);
    expect(wordCount(rest)).toBe(100);
  });
  it("chương ngắn hơn 300 từ hoặc rỗng: cả chương là mở đầu", () => {
    expect(splitOpening("ngắn thôi")).toEqual({ opening: "ngắn thôi", rest: "" });
    expect(splitOpening("")).toEqual({ opening: "", rest: "" });
  });
});

describe("replaceOpening", () => {
  it("thay đúng phần mở đầu", () => {
    expect(replaceOpening(chapter, "mở đầu mới")).toBe("mở đầu mới\n\nthân chương");
  });
  it("AI chép luôn thân thì không nhân đôi", () => {
    expect(replaceOpening(chapter, "mở đầu mới\n\nthân chương")).toBe("mở đầu mới\n\nthân chương");
  });
});

describe("prompt biên tập", () => {
  it("reviewPrompt liệt kê đủ luật có đánh số và kèm đoạn mở đầu", () => {
    const p = reviewPrompt("Câu mở.");
    OPENING_RULES.forEach((rule, i) => expect(p.prompt).toContain(`${i}. ${rule}`));
    expect(p.prompt).toContain("Câu mở.");
  });
  it("rewriteOpeningPrompt chỉ nêu luật hỏng", () => {
    const p = rewriteOpeningPrompt(base, "mở", [0, 3]);
    expect(p.prompt).toContain(OPENING_RULES[0]);
    expect(p.prompt).toContain(OPENING_RULES[3]);
    expect(p.prompt).not.toContain(OPENING_RULES[1]);
  });
});

describe("polishOpening", () => {
  it("đạt ngay thì giữ nguyên, không viết lại", async () => {
    const ai = fakeAi([{ pass: true, failed: [] }]);
    expect(await polishOpening(chapter, base, ai)).toEqual({ content: chapter, warning: null });
    expect(ai.generateText).not.toHaveBeenCalled();
  });
  it("đạt sau 1 lần viết lại thì dùng bản mới", async () => {
    const ai = fakeAi([{ pass: false, failed: [0] }, { pass: true, failed: [] }]);
    expect(await polishOpening(chapter, base, ai)).toEqual({ content: "mở đầu mới 1\n\nthân chương", warning: null });
  });
  it("hỏng mãi: viết lại đúng 2 lần, giữ bản ít lỗi nhất và cảnh báo", async () => {
    const ai = fakeAi([{ pass: false, failed: [0, 1, 2] }, { pass: false, failed: [1] }, { pass: false, failed: [1, 2] }]);
    const r = await polishOpening(chapter, base, ai);
    expect(ai.generateText).toHaveBeenCalledTimes(2);
    expect(r.content).toBe("mở đầu mới 1\n\nthân chương");
    expect(r.warning).toMatch(/chưa đạt/);
  });
  it("chấm lỗi (JSON hỏng/mạng) thì giữ bản gốc, không cảnh báo", async () => {
    const ai = fakeAi([new Error("bad json")]);
    expect(await polishOpening(chapter, base, ai)).toEqual({ content: chapter, warning: null });
  });
  it("hết quota thì ném lại để daily dừng như cũ", async () => {
    const ai = fakeAi([new QuotaExhaustedError("hết lượt")]);
    await expect(polishOpening(chapter, base, ai)).rejects.toBeInstanceOf(QuotaExhaustedError);
  });
  it("chương rỗng thì không gọi AI", async () => {
    const ai = fakeAi([{ pass: true, failed: [] }]);
    expect(await polishOpening("", base, ai)).toEqual({ content: "", warning: null });
    expect(ai.generateJson).not.toHaveBeenCalled();
  });
});
