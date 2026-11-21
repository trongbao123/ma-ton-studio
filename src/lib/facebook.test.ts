import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangePageToken, FacebookAuthError, fbKey, graphError, pagesFromRows, parseFacebookAuth, pickPage } from "./facebook";

const PAGE = "61596491473917";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("token Page Facebook", () => {
  beforeEach(() => {
    process.env.FB_APP_ID = "app";
    process.env.FB_APP_SECRET = "secret";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("khoá app_settings theo kênh", () => {
    expect(fbKey("lich-su")).toBe("facebook:lich-su");
  });

  it("chọn đúng Page theo id, không thấy thì liệt kê các Page tìm được", () => {
    const pages = [
      { id: "1", name: "A", access_token: "t1" },
      { id: PAGE, name: "Sử Ký Kể Chuyện", access_token: "t2" },
    ];
    expect(pickPage(pages, PAGE).access_token).toBe("t2");
    expect(() => pickPage(pages, "999")).toThrow(/A \(1\)[\s\S]*Sử Ký Kể Chuyện \(61596491473917\)/);
  });

  it("phân loại lỗi Graph: token (190), quyền, còn lại", () => {
    expect(graphError({ error: { code: 190, message: "expired" } }, 400)).toBeInstanceOf(FacebookAuthError);
    expect(graphError({ error: { code: 200, message: "perm" } }, 403).message).toContain("quyền");
    expect(graphError({}, 500).message).toContain("500");
  });

  it("đổi user token ngắn hạn → dài hạn → token Page", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "long" }))
      .mockResolvedValueOnce(json({ data: [{ id: PAGE, name: "Sử Ký Kể Chuyện", access_token: "pt" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const auth = await exchangePageToken("short", PAGE);
    expect(auth).toMatchObject({ pageId: PAGE, pageName: "Sử Ký Kể Chuyện", pageToken: "pt" });
    const [u1, u2] = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(u1).toContain("grant_type=fb_exchange_token");
    expect(u1).toContain("fb_exchange_token=short");
    expect(u2).toContain("/me/accounts");
    expect(u2).toContain("access_token=long");
  });

  it("user token đã hết hạn → FacebookAuthError, không gọi bước lấy Page", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(json({ error: { code: 190, message: "expired" } }, 400));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(exchangePageToken("short", PAGE)).rejects.toBeInstanceOf(FacebookAuthError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("liệt kê Page đã kết nối từ các dòng app_settings, bỏ khoá khác và không lộ token", () => {
    const rows = [
      { key: "facebook:lich-su", value: { pageId: PAGE, pageName: "Sử Ký Kể Chuyện", pageToken: "t", connectedAt: "x" } },
      { key: "youtube:lich-su", value: { refreshToken: "r" } },
      { key: "facebook:hong", value: {} },
    ];
    expect(pagesFromRows(rows)).toEqual([{ channel: "lich-su", pageName: "Sử Ký Kể Chuyện", pageId: PAGE }]);
  });

  it("đọc bản ghi đã lưu; giá trị chưa mã hoá đọc nguyên", () => {
    expect(parseFacebookAuth(undefined)).toBeNull();
    expect(parseFacebookAuth({ pageId: "1", pageName: "A", pageToken: "plain", connectedAt: "x" })?.pageToken).toBe("plain");
  });
});
