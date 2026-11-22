import { describe, expect, it } from "vitest";
import type { Cue } from "@/../pipeline/text";
import { SCENE_MAX_SECONDS, SCENE_MIN_SECONDS, scenesToShots, storyboardPrompt, type DirectedScene } from "./storyboard";

const scene = (o: Partial<DirectedScene> & { from: number; to: number }): DirectedScene => ({
  kind: "map",
  camera: "hold",
  sfx: [],
  ...o,
});

/** Mỗi câu 1 giây, khoảng lặng ở cuối mỗi câu. */
const cues = (n: number): Cue[] => Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, text: `Câu ${i}.` }) as Cue);

describe("đổi cảnh thành shot theo mốc giọng đọc", () => {
  it("cảnh dài hơn 6 giây bị chia nhỏ, cảnh ngắn hơn 3 giây gộp với cảnh kề cùng loại", () => {
    const shots = scenesToShots([scene({ from: 0, to: 8 }), scene({ from: 9, to: 9 }), scene({ from: 10, to: 13 })], cues(14), 14);
    for (const s of shots) {
      expect(s.end - s.start).toBeLessThanOrEqual(SCENE_MAX_SECONDS);
      expect(s.end - s.start).toBeGreaterThanOrEqual(SCENE_MIN_SECONDS);
    }
  });

  it("các shot phủ kín giọng đọc, không hở và không chồng lấn", () => {
    const shots = scenesToShots([scene({ from: 0, to: 4 }), scene({ from: 5, to: 9 })], cues(10), 10);
    expect(shots[0].start).toBe(0);
    expect(shots.at(-1)!.end).toBe(10);
    for (let i = 1; i < shots.length; i++) expect(shots[i].start).toBe(shots[i - 1].end);
  });

  it("cảnh cuối co giãn cho khớp đúng độ dài giọng đọc", () => {
    expect(scenesToShots([scene({ from: 0, to: 3 })], cues(4), 7.5).at(-1)!.end).toBe(7.5);
  });

  it("giữ nguyên nội dung đạo diễn của cảnh", () => {
    const [shot] = scenesToShots([scene({ from: 0, to: 3, kind: "terrain", places: ["Tam Điệp, Ninh Bình"], sfx: ["drum"] })], cues(4), 4);
    expect(shot).toMatchObject({ kind: "terrain", places: ["Tam Điệp, Ninh Bình"], sfx: ["drum"] });
  });
});

describe("prompt đạo diễn", () => {
  it("đưa kịch bản và hồ sơ vào, nêu đủ 4 loại cảnh, cấm châm biếm", () => {
    const p = storyboardPrompt("KỊCH BẢN XYZ", "HỒ SƠ ABC");
    expect(p.prompt).toContain("KỊCH BẢN XYZ");
    expect(p.prompt).toContain("HỒ SƠ ABC");
    for (const kind of ["map", "terrain", "card", "art"]) expect(p.prompt).toContain(kind);
    expect(`${p.system}\n${p.prompt}`).toMatch(/không châm biếm/i);
  });
});

describe("đổi chỉ số CÂU sang giây (mốc giọng chia nhỏ hơn câu)", () => {
  /** Giống thật: mỗi câu dài bị text.ts chẻ thành nhiều cue 70 ký tự. */
  const longScript = Array.from({ length: 6 }, (_, i) => `Câu số ${i} ${"x".repeat(110)}.`).join(" ");
  const manyCues: Cue[] = [];
  {
    let t = 0;
    for (const piece of longScript.match(/.{1,70}/g) ?? []) {
      manyCues.push({ start: t, end: t + 1, text: piece } as Cue);
      t += 1;
    }
  }

  it("cảnh phủ hết 6 câu thì phủ hết giọng đọc, không dồn vào cảnh cuối", () => {
    const shots = scenesToShots([scene({ from: 0, to: 2 }), scene({ from: 3, to: 5 })], manyCues, manyCues.length);
    for (const s of shots) expect(s.end - s.start).toBeLessThanOrEqual(SCENE_MAX_SECONDS);
    expect(shots.at(-1)!.end).toBe(manyCues.length);
  });

  it("AI chỉ phủ 60% số câu → chèn thêm cảnh, KHÔNG giãn cảnh cuối thành hàng chục phút", () => {
    const shots = scenesToShots([scene({ from: 0, to: 1 }), scene({ from: 2, to: 3 })], manyCues, manyCues.length);
    for (const s of shots) expect(s.end - s.start).toBeLessThanOrEqual(SCENE_MAX_SECONDS);
    expect(shots.at(-1)!.end).toBe(manyCues.length);
  });

  it("prompt đánh số từng câu để AI khỏi tự đếm", () => {
    expect(storyboardPrompt("Câu một. Câu hai. Câu ba.", "hồ sơ").prompt).toContain("[1] Câu hai.");
  });
});
