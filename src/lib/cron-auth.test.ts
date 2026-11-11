import { describe, expect, it } from "vitest";
import { cronAuth, dispatchUrl } from "./cron-auth";

describe("cronAuth", () => {
  it("đúng token Vercel Cron gửi kèm thì cho qua", () => {
    expect(cronAuth("Bearer abc123", "abc123")).toBe("ok");
  });
  it("CHƯA đặt CRON_SECRET thì từ chối — để ngỏ là ai cũng kích hoạt được lượt daily", () => {
    expect(cronAuth("Bearer abc123", undefined)).toBe("chua-dat-secret");
    expect(cronAuth(null, "")).toBe("chua-dat-secret");
  });
  it("sai hoặc thiếu token thì từ chối", () => {
    expect(cronAuth("Bearer sai", "abc123")).toBe("sai-token");
    expect(cronAuth(null, "abc123")).toBe("sai-token");
    expect(cronAuth("abc123", "abc123")).toBe("sai-token");
  });
  it("so sánh không bị lệch vì khoảng trắng thừa", () => {
    expect(cronAuth("Bearer  abc123", "abc123")).toBe("sai-token");
  });
});

describe("dispatchUrl", () => {
  it("trỏ đúng workflow daily của repo", () => {
    expect(dispatchUrl("trongbao123/ma-ton-studio", "daily.yml")).toBe(
      "https://api.github.com/repos/trongbao123/ma-ton-studio/actions/workflows/daily.yml/dispatches",
    );
  });
  it("repo sai dạng thì null, không ghép URL bậy", () => {
    expect(dispatchUrl("", "daily.yml")).toBeNull();
    expect(dispatchUrl("../../evil", "daily.yml")).toBeNull();
    expect(dispatchUrl("chi-co-ten", "daily.yml")).toBeNull();
  });
});
