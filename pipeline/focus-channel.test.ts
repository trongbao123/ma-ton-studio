import { describe, expect, it } from "vitest";
import { focusChannel } from "./episode-plan";

describe("chia ngày giữa hai kênh", () => {
  it("23/11 lịch sử, 24/11 chuyện đời, xen kẽ", () => {
    expect(focusChannel(new Date("2026-11-23T03:00:00Z"))).toBe("lich-su");
    expect(focusChannel(new Date("2026-11-24T03:00:00Z"))).toBe("chuyen-doi");
    expect(focusChannel(new Date("2026-11-25T03:00:00Z"))).toBe("lich-su");
    expect(focusChannel(new Date("2026-12-01T03:00:00Z"))).toBe("lich-su");
  });
  it("tính theo ngày giờ Việt Nam (UTC+7)", () => {
    // 23/11 18:00 UTC = 24/11 01:00 giờ VN → ngày chuyện đời
    expect(focusChannel(new Date("2026-11-23T18:00:00Z"))).toBe("chuyen-doi");
  });
});
