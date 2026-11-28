import { describe, expect, it } from "vitest";
import { HISTORY_GENRE } from "@/lib/story/history";
import { isRenderStuck, renderQueueOrder, shouldDispatchHistoryAuto, type RenderQueueRow } from "./daily";

const row = (o: Partial<RenderQueueRow>): RenderQueueRow => ({ id: 1, channel: "main", genre: "Tiên hiệp", ...o });

describe("lọc video lịch sử khỏi hàng đợi render chung (historyauto lo trọn)", () => {
  it("video lịch sử không vào hàng đợi chung, dù ngày nào", () => {
    const rows = [row({ id: 1, genre: HISTORY_GENRE, channel: "lich-su" }), row({ id: 2, genre: "Tiên hiệp" })];
    expect(renderQueueOrder(rows, "lich-su").map((r) => r.id)).toEqual([2]);
    expect(renderQueueOrder(rows, "chuyen-doi").map((r) => r.id)).toEqual([2]);
  });

  it("kênh phụ (không phải main) render trước kênh gốc", () => {
    const rows = [row({ id: 1, channel: "main" }), row({ id: 2, channel: "chuyen-doi" })];
    expect(renderQueueOrder(rows, "chuyen-doi").map((r) => r.id)).toEqual([2, 1]);
  });

  it("ngày kênh lịch sử: video chuyện đời tạm không vào hàng đợi, nhường lượt vẽ cho lịch sử", () => {
    const rows = [row({ id: 1, channel: "chuyen-doi" }), row({ id: 2, channel: "main" })];
    expect(renderQueueOrder(rows, "lich-su").map((r) => r.id)).toEqual([2]);
  });

  it("cùng kênh thì theo thứ tự id tăng dần", () => {
    const rows = [row({ id: 5 }), row({ id: 2 }), row({ id: 3 })];
    expect(renderQueueOrder(rows, "chuyen-doi").map((r) => r.id)).toEqual([2, 3, 5]);
  });
});

describe("video kẹt 'đang render' quá lâu (job bị huỷ/hết giờ giữa chừng)", () => {
  const now = new Date("2026-11-28T12:00:00Z");

  it("video thường kẹt quá 30 phút → requeue", () => {
    expect(isRenderStuck(false, new Date("2026-11-28T11:29:00Z"), now)).toBe(true);
    expect(isRenderStuck(false, new Date("2026-11-28T11:31:00Z"), now)).toBe(false);
  });

  it("video lịch sử chưa quá 7 giờ dù hơn 30 phút → KHÔNG requeue (dựng tới 4,5 giờ)", () => {
    expect(isRenderStuck(true, new Date("2026-11-28T08:00:00Z"), now)).toBe(false);
  });

  it("video lịch sử quá 7 giờ → requeue", () => {
    expect(isRenderStuck(true, new Date("2026-11-28T04:59:00Z"), now)).toBe(true);
  });
});

describe("daily có nên dispatch dựng video lịch sử kế tiếp không", () => {
  it("đang có video dựng → không dispatch thêm (chống chạy trùng)", () => {
    expect(shouldDispatchHistoryAuto({ hasRendering: true, readyCount: 0 })).toBe(false);
  });

  it("không có video dựng và kho chờ đăng chưa đủ → dispatch", () => {
    expect(shouldDispatchHistoryAuto({ hasRendering: false, readyCount: 0 }, 2)).toBe(true);
  });

  it("kho chờ đăng đã đủ → không dispatch thêm", () => {
    expect(shouldDispatchHistoryAuto({ hasRendering: false, readyCount: 2 }, 2)).toBe(false);
  });
});
