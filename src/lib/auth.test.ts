import { describe, expect, it } from "vitest";
import { isAuthorized } from "./auth";

const basic = (user: string, pass: string) =>
  "Basic " + btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${pass}`)));

describe("isAuthorized", () => {
  it("chấp nhận đúng mật khẩu, bỏ qua username", () => {
    expect(isAuthorized(basic("ai-cung-duoc", "bi-mat"), "bi-mat")).toBe(true);
  });

  it("hỗ trợ mật khẩu có dấu và có dấu hai chấm", () => {
    expect(isAuthorized(basic("u", "ma:tôn"), "ma:tôn")).toBe(true);
  });

  it("từ chối sai mật khẩu, thiếu header, header hỏng", () => {
    expect(isAuthorized(basic("u", "sai"), "bi-mat")).toBe(false);
    expect(isAuthorized(null, "bi-mat")).toBe(false);
    expect(isAuthorized("Basic %%%không-phải-base64", "bi-mat")).toBe(false);
    expect(isAuthorized("Bearer abc", "bi-mat")).toBe(false);
  });

  it("kiểm username khi có ADMIN_USER", () => {
    expect(isAuthorized(basic("trongbao", "pw"), "pw", "trongbao")).toBe(true);
    expect(isAuthorized(basic("khac", "pw"), "pw", "trongbao")).toBe(false);
  });

  it("chặn tất cả khi chưa cấu hình ADMIN_PASSWORD", () => {
    expect(isAuthorized(basic("u", ""), undefined)).toBe(false);
    expect(isAuthorized(basic("u", ""), "")).toBe(false);
  });
});
