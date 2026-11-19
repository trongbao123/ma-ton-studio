import { describe, expect, it } from "vitest";
import { mergeScripts, NARRATOR, splitForDirecting } from "./voice-cast";

const para = (n: number) => Array.from({ length: n }, () => "chữ").join(" ");

describe("splitForDirecting", () => {
  it("truyện ngắn: một phần, giữ nguyên đoạn", () => {
    expect(splitForDirecting(`${para(10)}\n\n${para(10)}`, 100)).toEqual([`${para(10)}\n\n${para(10)}`]);
  });
  it("truyện dài: cắt theo đoạn, mỗi phần ≤ giới hạn, không mất chữ", () => {
    const text = Array.from({ length: 12 }, () => para(1000)).join("\n");
    const parts = splitForDirecting(text, 2500);
    expect(parts).toHaveLength(6);
    for (const p of parts) expect(p.split(/\s+/).length).toBeLessThanOrEqual(2500);
    expect(parts.join(" ").split(/\s+/).length).toBe(12000);
  });
});

describe("mergeScripts", () => {
  it("người kể của phần đầu, nhân vật gộp theo tên, lượt nối đúng thứ tự", () => {
    const m = mergeScripts([
      { narrator: { gender: "female", age: 60 }, characters: [{ name: "Khoa", gender: "male", age: 35 }], turns: [{ speaker: NARRATOR, style: "", text: "a" }] },
      {
        narrator: { gender: "male", age: 40 },
        characters: [{ name: "Khoa", gender: "male", age: 30 }, { name: "Linh", gender: "female", age: 28 }],
        turns: [{ speaker: "Khoa", style: "", text: "b" }],
      },
    ]);
    expect(m.narrator).toEqual({ gender: "female", age: 60 });
    expect(m.characters).toEqual([{ name: "Khoa", gender: "male", age: 35 }, { name: "Linh", gender: "female", age: 28 }]);
    expect(m.turns.map((t) => t.text)).toEqual(["a", "b"]);
  });
});

describe("ivoiSegments bỏ mẩu không có chữ", () => {
  it("mẩu chỉ dấu câu giữa hai thẻ không thành lượt gọi ivoi", async () => {
    const { ivoiSegments, NARRATOR } = await import("./voice-cast");
    const seg = ivoiSegments([{ speaker: NARRATOR, style: "", text: "Tôi đứng yên. <sigh> … <long pause> Rồi tôi đi." }], { [NARRATOR]: "x" }, 4000);
    expect(seg.every((s) => /[\p{L}\p{N}]/u.test(s.text))).toBe(true);
    expect(seg.map((s) => s.text).join(" ")).toContain("Rồi tôi đi.");
  });
});
