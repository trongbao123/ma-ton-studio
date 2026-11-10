import { describe, expect, it } from "vitest";
import { createSession, SESSION_DAYS, verifySession } from "./session";

describe("session", () => {
  it("token hợp lệ với đúng mật khẩu", async () => {
    const t = await createSession("bi-mat", "trongbao");
    expect(await verifySession(t, "bi-mat", "trongbao")).toBe(true);
  });
  it("đổi mật khẩu / user thì phiên cũ hết hiệu lực", async () => {
    const t = await createSession("bi-mat", "trongbao");
    expect(await verifySession(t, "mat-khau-moi", "trongbao")).toBe(false);
    expect(await verifySession(t, "bi-mat", "khac")).toBe(false);
  });
  it("hết hạn sau SESSION_DAYS ngày", async () => {
    const now = Date.now();
    const t = await createSession("pw", undefined, now);
    expect(await verifySession(t, "pw", undefined, now + (SESSION_DAYS - 1) * 86_400_000)).toBe(true);
    expect(await verifySession(t, "pw", undefined, now + (SESSION_DAYS + 1) * 86_400_000)).toBe(false);
  });
  it("từ chối token sửa tay / rỗng / chưa cấu hình mật khẩu", async () => {
    const t = await createSession("pw");
    const [exp, mac] = t.split(".");
    expect(await verifySession(`${Number(exp) + 1}.${mac}`, "pw")).toBe(false);
    expect(await verifySession(undefined, "pw")).toBe(false);
    expect(await verifySession("rac", "pw")).toBe(false);
    expect(await verifySession(t, undefined)).toBe(false);
  });
});
