import { describe, expect, it, vi } from "vitest";
import type { TextProvider } from "@/lib/ai/types";
import { applyFactFixes, FACT_FIX_ROUNDS, factCheckPrompt, factCheckScript } from "./fact-check";
import type { FactIssue } from "./history-types";

const issue = (quote: string, fix: string): FactIssue => ({ quote, verdict: "mau-thuan", note: "sai năm", fix });

/** AI giả: mỗi lần soát trả lần lượt các danh sách lỗi định sẵn. */
function fakeAi(...rounds: FactIssue[][]) {
  const generateJson = vi.fn();
  for (const issues of rounds) generateJson.mockResolvedValueOnce({ issues });
  return { ai: { name: "fake", generateText: vi.fn(), generateJson } as unknown as TextProvider, generateJson };
}

describe("vá kịch bản theo lỗi sự thật", () => {
  it("thay đúng câu sai bằng câu sửa", () => {
    expect(applyFactFixes("Năm 939 Ngô Quyền thắng. Trời mưa.", [issue("Năm 939", "Năm 938")])).toBe("Năm 938 Ngô Quyền thắng. Trời mưa.");
  });
  it("câu sửa rỗng → xoá câu, không để lại hai khoảng trắng", () => {
    const out = applyFactFixes("Năm 938 Ngô Quyền thắng. Trời mưa. Hết.", [issue(" Trời mưa.", "")]);
    expect(out).not.toContain("Trời mưa");
    expect(out).not.toMatch(/ {2}/);
  });
  it("câu AI trích không khớp nguyên văn → giữ nguyên kịch bản", () => {
    expect(applyFactFixes("Năm 938.", [issue("Năm 1000", "x")])).toBe("Năm 938.");
  });
});

describe("soát sự thật nhiều vòng", () => {
  it("lỗi được vá ở vòng 1, vòng 2 sạch → đạt", async () => {
    const { ai, generateJson } = fakeAi([issue("Năm 939", "Năm 938")], []);
    const r = await factCheckScript(ai, "Năm 939 Ngô Quyền thắng.", "HỒ SƠ");
    expect(r.issues).toEqual([]);
    expect(r.script).toBe("Năm 938 Ngô Quyền thắng.");
    expect(generateJson).toHaveBeenCalledTimes(2);
  });
  it("lỗi mãi không hết → dừng sau 1 + FACT_FIX_ROUNDS lần soát, trả lỗi của lần cuối", async () => {
    const last = [issue("không có", "x")];
    const { ai, generateJson } = fakeAi([issue("a", "b")], [issue("c", "d")], last);
    const r = await factCheckScript(ai, "kịch bản", "HỒ SƠ");
    expect(generateJson).toHaveBeenCalledTimes(1 + FACT_FIX_ROUNDS);
    expect(r.issues).toEqual(last);
  });
  it("prompt soát chứa nguyên kịch bản và hồ sơ", () => {
    const p = factCheckPrompt("KỊCH BẢN XYZ", "HỒ SƠ ABC");
    expect(p.prompt).toContain("KỊCH BẢN XYZ");
    expect(p.prompt).toContain("HỒ SƠ ABC");
  });
});
