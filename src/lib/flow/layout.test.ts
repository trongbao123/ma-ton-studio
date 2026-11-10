import { describe, expect, it } from "vitest";
import { CARD_WIDTH, DEFAULT_POSITIONS, mergeLayout } from "./layout";
import { CARD_ORDER } from "./model";

const full = () => Object.fromEntries(CARD_ORDER.map((id, i) => [id, { x: i * (CARD_WIDTH + 10), y: 5 }]));

describe("mergeLayout", () => {
  it("mặc định: một hàng ngang, đủ 7 thẻ, x tăng dần", () => {
    const xs = CARD_ORDER.map((id) => DEFAULT_POSITIONS[id].x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(CARD_ORDER.map((id) => DEFAULT_POSITIONS[id].y)).size).toBe(1);
    expect(CARD_ORDER).toHaveLength(7);
  });

  it("bố cục đủ thẻ và hợp lệ thì giữ nguyên", () => {
    expect(mergeLayout(full()).seo).toEqual({ x: 2 * (CARD_WIDTH + 10), y: 5 });
  });

  it("bố cục cũ (id trigger/agent/node con) không khớp → về mặc định cả bộ", () => {
    const old = { trigger: { x: 0, y: 150 }, agent: { x: 170, y: 145 }, tts: { x: 490, y: 150 }, images: { x: 650, y: 150 }, video: { x: 810, y: 150 }, youtube: { x: 970, y: 150 }, model: { x: 1, y: 2 } };
    expect(mergeLayout(old)).toEqual(DEFAULT_POSITIONS);
  });

  it("một thẻ hỏng toạ độ → về mặc định cả bộ; rác/null cũng không crash", () => {
    expect(mergeLayout({ ...full(), seo: { x: "a", y: 1 } })).toEqual(DEFAULT_POSITIONS);
    expect(mergeLayout(null)).toEqual(DEFAULT_POSITIONS);
    expect(mergeLayout("x")).toEqual(DEFAULT_POSITIONS);
  });

  it("lệch hàng (zigzag) hoặc chồng nhau → về mặc định", () => {
    expect(mergeLayout({ ...full(), seo: { x: 2 * (CARD_WIDTH + 10), y: 90 } })).toEqual(DEFAULT_POSITIONS);
    expect(mergeLayout({ ...full(), tts: { x: 2 * (CARD_WIDTH + 10) + 20, y: 5 } })).toEqual(DEFAULT_POSITIONS);
  });

  it("bố cục cũ thẻ hẹp (cách 216px) → về mặc định", () => {
    const narrow = Object.fromEntries(CARD_ORDER.map((id, i) => [id, { x: i * 216, y: 0 }]));
    expect(mergeLayout(narrow)).toEqual(DEFAULT_POSITIONS);
  });

  it("bỏ khoá lạ khi lưu", () => {
    expect(Object.keys(mergeLayout({ ...full(), lạ: { x: 1, y: 1 } }))).toEqual(CARD_ORDER);
  });
});
