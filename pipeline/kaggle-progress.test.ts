import { afterEach, describe, expect, it } from "vitest";
import { WEB_URL } from "@/lib/notify";
import { progressConfig } from "./kaggle";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("progressConfig", () => {
  it("có token thì dựng URL webhook, KHÔNG cần đặt WEB_URL — Actions không có biến đó", () => {
    delete process.env.WEB_URL;
    process.env.I2V_PROGRESS_TOKEN = "t";
    const c = progressConfig("mts-i2v-run-7-abc", 7, 3);
    expect(c?.url).toMatch(/^https:\/\/.+\/api\/i2v\/progress$/);
    expect(c).toMatchObject({ token: "t", slug: "mts-i2v-run-7-abc", videoId: 7, total: 3 });
  });

  // WEB_URL là hằng số đọc env MỘT LẦN lúc nạp module (notify.ts), nên URL phải khớp đúng hằng số đó
  // chứ không đọc lại process.env — đổi env giữa chừng không có tác dụng, và production cũng không cần.
  it("dựng từ đúng WEB_URL dùng chung, không tự ghép tay", () => {
    process.env.I2V_PROGRESS_TOKEN = "t";
    expect(progressConfig("mts-i2v-run-0-a", 0, 1)?.url).toBe(`${WEB_URL.replace(/\/$/, "")}/api/i2v/progress`);
  });

  it("KHÔNG có token thì không gửi gì — đừng rải chỗ gọi vào dataset khi chưa bật tính năng", () => {
    delete process.env.I2V_PROGRESS_TOKEN;
    expect(progressConfig("mts-i2v-run-0-a", 0, 1)).toBeUndefined();
  });
});
