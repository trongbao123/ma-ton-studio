import { describe, expect, it } from "vitest";
import { castVoices, faithful, groupTurns, NARRATOR, stripTags, type Turn } from "./voice-cast";

const turns: Turn[] = [
  { speaker: NARRATOR, style: "slow", text: "Tôi năm nay năm mươi lăm tuổi. <sigh>" },
  { speaker: "Khoa", style: "cold", text: "Mẹ sang ở tạm nhà con Linh đi." },
  { speaker: NARRATOR, style: "", text: "Tôi đứng yên." },
  { speaker: "Linh", style: "awkward", text: "Nhà con có hai phòng." },
  { speaker: "ông Bảy", style: "warm", text: "Tôi biết thế nào bà cũng về." },
];
const script = {
  narrator: { gender: "female" as const, age: 55 },
  characters: [
    { name: "Khoa", gender: "male" as const, age: 33 },
    { name: "Linh", gender: "female" as const, age: 30 },
    { name: "ông Bảy", gender: "male" as const, age: 75 },
  ],
  turns,
};

describe("phân vai", () => {
  it("mẹ 55 tuổi giọng nữ trung niên, mỗi nhân vật một giọng khác nhau", () => {
    const cast = castVoices(script);
    expect(cast[NARRATOR]).toBe("Gacrux");
    expect(cast["ông Bảy"]).toBe("Algenib");
    expect(cast.Khoa).toBe("Charon");
    expect(new Set(Object.values(cast)).size).toBe(4);
  });
  it("nhóm gọi TTS tối đa 2 giọng", () => {
    const cast = castVoices(script);
    const groups = groupTurns(turns, cast);
    for (const g of groups) expect(new Set(g.map((t) => cast[t.speaker])).size).toBeLessThanOrEqual(2);
    expect(groups.flat()).toEqual(turns);
  });
  it("cắt nhóm theo độ dài", () => {
    const cast = { [NARRATOR]: "Gacrux" };
    const long = Array.from({ length: 5 }, () => ({ speaker: NARRATOR, style: "", text: "a".repeat(1000) }));
    expect(groupTurns(long, cast, 3000).map((g) => g.length)).toEqual([3, 2]);
  });
});

describe("giữ đúng chữ truyện", () => {
  const original = "Tôi năm nay năm mươi lăm tuổi.\n\n– Mẹ sang ở tạm nhà con Linh đi – Khoa nói.";
  it("chỉ thêm thẻ / đổi dấu → nhận", () => {
    expect(faithful(original, [
      { speaker: NARRATOR, style: "", text: "Tôi năm nay năm mươi lăm tuổi. <sigh>" },
      { speaker: "Khoa", style: "", text: "Mẹ sang ở tạm nhà con Linh đi" },
      { speaker: NARRATOR, style: "", text: "Khoa nói." },
    ])).toBe(true);
  });
  it("bỏ đoạn → không nhận", () => {
    expect(faithful(original, [{ speaker: NARRATOR, style: "", text: "Tôi năm nay năm mươi lăm tuổi." }])).toBe(false);
  });
  it("bỏ thẻ khi làm phụ đề", () => {
    expect(stripTags("Tôi đứng yên. <long pause> Rồi tôi đi.")).toBe("Tôi đứng yên. Rồi tôi đi.");
  });
});
