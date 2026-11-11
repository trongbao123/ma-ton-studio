import { describe, expect, it } from "vitest";
import { CARD_GAP, CARD_WIDTH, DEFAULT_POSITIONS, mergeLayout, pickSubPositions, subKey, ROW_OF, ROW_PITCH, TREE_ROWS } from "./layout";
import { CARD_ORDER } from "./model";

const full = () => Object.fromEntries(CARD_ORDER.map((id, i) => [id, { x: i * 10, y: 5 + i }]));
const centerX = (id: (typeof CARD_ORDER)[number]) => DEFAULT_POSITIONS[id].x + CARD_WIDTH / 2;

describe("cây mặc định", () => {
  it("đủ 11 thẻ, mỗi thẻ đúng một hàng", () => {
    expect(CARD_ORDER).toHaveLength(11);
    expect(TREE_ROWS.flat().sort()).toEqual([...CARD_ORDER].sort());
  });

  it("hàng r nằm ở y = r * ROW_PITCH, y tăng dần từ trên xuống", () => {
    for (const id of CARD_ORDER) expect(DEFAULT_POSITIONS[id].y).toBe(ROW_OF[id] * ROW_PITCH);
    expect(DEFAULT_POSITIONS.trends.y).toBeLessThan(DEFAULT_POSITIONS.youtube.y);
  });

  it("thẻ đơn nằm giữa trục x = 0; nhánh song song đối xứng quanh trục", () => {
    for (const id of ["trends", "chapter", "seo", "video", "youtube"] as const) expect(centerX(id)).toBe(0);
    const step = CARD_WIDTH + CARD_GAP;
    expect(centerX("tts")).toBe(-1.5 * step);
    expect(centerX("images")).toBe(-0.5 * step);
    expect(centerX("i2v")).toBe(0.5 * step);
    expect(centerX("thumbnail")).toBe(1.5 * step);
    expect(centerX("long") + centerX("short")).toBe(0);
    expect(centerX("short") - centerX("long")).toBe(CARD_WIDTH + CARD_GAP);
  });

  it("4 nhánh song song cùng hàng; Video dài / Short cùng hàng", () => {
    expect(new Set(["tts", "images", "i2v", "thumbnail"].map((id) => DEFAULT_POSITIONS[id as "tts"].y)).size).toBe(1);
    expect(DEFAULT_POSITIONS.long.y).toBe(DEFAULT_POSITIONS.short.y);
  });
});

describe("mergeLayout", () => {
  it("bố cục đủ thẻ và hợp lệ thì giữ nguyên", () => {
    expect(mergeLayout(full()).seo).toEqual({ x: 20, y: 7 });
  });

  it("bố cục hàng ngang cũ (7 thẻ, thiếu thumbnail/long/short) → về cây mặc định", () => {
    const old = Object.fromEntries(["trends", "chapter", "seo", "tts", "images", "video", "youtube"].map((id, i) => [id, { x: i * 304, y: 0 }]));
    expect(mergeLayout(old)).toEqual(DEFAULT_POSITIONS);
  });

  it("bố cục của mô hình cũ hơn (id trigger/agent/node con) → về mặc định cả bộ", () => {
    const old = { trigger: { x: 0, y: 150 }, agent: { x: 170, y: 145 }, tts: { x: 490, y: 150 }, images: { x: 650, y: 150 }, video: { x: 810, y: 150 }, youtube: { x: 970, y: 150 }, model: { x: 1, y: 2 } };
    expect(mergeLayout(old)).toEqual(DEFAULT_POSITIONS);
  });

  it("một thẻ hỏng toạ độ → về mặc định cả bộ; rác/null cũng không crash", () => {
    expect(mergeLayout({ ...full(), seo: { x: "a", y: 1 } })).toEqual(DEFAULT_POSITIONS);
    expect(mergeLayout(null)).toEqual(DEFAULT_POSITIONS);
    expect(mergeLayout("x")).toEqual(DEFAULT_POSITIONS);
  });

  it("giữ vị trí kéo thả tự do (lệch hàng vẫn giữ)", () => {
    const moved = { ...full(), seo: { x: 500, y: 90 } };
    expect(mergeLayout(moved).seo).toEqual({ x: 500, y: 90 });
  });

  it("bỏ khoá lạ khi lưu", () => {
    expect(Object.keys(mergeLayout({ ...full(), lạ: { x: 1, y: 1 } }))).toEqual(CARD_ORDER);
  });
});

describe("bố cục ngang", () => {
  it("mỗi hàng của cây dọc thành một cột, x tăng dần từ trái sang phải", async () => {
    const { COL_PITCH, DEFAULT_POSITIONS_H } = await import("./layout");
    for (const id of CARD_ORDER) expect(DEFAULT_POSITIONS_H[id].x).toBe(ROW_OF[id] * COL_PITCH);
    expect(DEFAULT_POSITIONS_H.trends.x).toBeLessThan(DEFAULT_POSITIONS_H.youtube.x);
  });
  it("nhánh song song xếp chồng trong cột, đối xứng quanh y = 0", async () => {
    const { DEFAULT_POSITIONS_H, STACK_PITCH } = await import("./layout");
    expect(DEFAULT_POSITIONS_H.tts.y).toBe(-1.5 * STACK_PITCH);
    expect(DEFAULT_POSITIONS_H.images.y).toBe(-0.5 * STACK_PITCH);
    expect(DEFAULT_POSITIONS_H.i2v.y).toBe(0.5 * STACK_PITCH);
    expect(DEFAULT_POSITIONS_H.thumbnail.y).toBe(1.5 * STACK_PITCH);
    expect(DEFAULT_POSITIONS_H.long.y + DEFAULT_POSITIONS_H.short.y).toBe(0);
  });
  it("bố cục ngang hỏng thì về mặc định NGANG, không về dọc", async () => {
    const { DEFAULT_POSITIONS_H } = await import("./layout");
    expect(mergeLayout(null, "h")).toEqual(DEFAULT_POSITIONS_H);
  });
});

describe("vị trí node con", () => {
  it("giữ khoá sub:* hợp lệ, bỏ khoá lạ và toạ độ hỏng", () => {
    const saved = { ...full(), "sub:seo-model": { x: 5, y: 9 }, "sub:bad": { x: "a", y: 1 }, lạ: { x: 1, y: 1 } };
    expect(pickSubPositions(saved)).toEqual({ [subKey("seo-model")]: { x: 5, y: 9 } });
    expect(pickSubPositions(null)).toEqual({});
  });
});
