import { describe, expect, it } from "vitest";
import type { Shot } from "@/lib/story/storyboard";
import { coldOpenShots, COLD_OPEN_SECONDS, COLD_OPEN_SHOT_MAX } from "./history-coldopen";

const shot = (o: Partial<Shot> & { start: number; end: number }): Shot => ({ kind: "map", from: 0, to: 1, camera: "hold", sfx: [], ...o });
/** Kịch bản 45 phút: 20 cảnh, vài cảnh có giao chiến. */
const many = Array.from({ length: 20 }, (_, i) =>
  shot({ start: i * 5, end: i * 5 + 5, ...(i % 6 === 3 ? { battles: [`Trận ${i}`] } : {}), ...(i % 4 === 2 ? { sfx: ["drum" as const] } : {}) }),
);

describe("mở đầu kiểu trailer", () => {
  it("tổng độ dài nằm trong 30–45 giây, mỗi cảnh ngắn", () => {
    const open = coldOpenShots(many);
    const total = open.reduce((n, s) => n + (s.end - s.start), 0);
    expect(total).toBeGreaterThanOrEqual(COLD_OPEN_SECONDS.min);
    expect(total).toBeLessThanOrEqual(COLD_OPEN_SECONDS.max);
    for (const s of open) expect(s.end - s.start).toBeLessThanOrEqual(COLD_OPEN_SHOT_MAX);
  });

  it("cảnh có giao chiến được chọn trước cảnh thường", () => {
    const open = coldOpenShots(many);
    const battles = many.filter((s) => s.battles?.length).length;
    expect(open.filter((s) => s.battles?.length)).toHaveLength(battles);
  });

  it("giữ đúng thứ tự thời gian của kịch bản", () => {
    const open = coldOpenShots(many);
    for (let i = 1; i < open.length; i++) expect(open[i].from).toBeGreaterThanOrEqual(open[i - 1].from);
  });

  it("các cảnh nối liền nhau từ giây 0", () => {
    const open = coldOpenShots(many);
    expect(open[0].start).toBe(0);
    for (let i = 1; i < open.length; i++) expect(open[i].start).toBeCloseTo(open[i - 1].end, 6);
  });

  it("kịch bản không có cảnh giao chiến nào vẫn đủ 30 giây", () => {
    const calm = Array.from({ length: 20 }, (_, i) => shot({ start: i * 5, end: i * 5 + 5, kind: "art" }));
    const total = coldOpenShots(calm).reduce((n, s) => n + (s.end - s.start), 0);
    expect(total).toBeGreaterThanOrEqual(COLD_OPEN_SECONDS.min);
  });
});
