import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertReelDuration, exchangePageToken, FacebookAuthError, publishPageVideoAs, publishReelAs, fbKey, graphError, pagesFromRows, parseFacebookAuth, pickPage } from "./facebook";

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

describe("đăng Reel", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = { pageId: PAGE, token: "pt" };
  async function tmpFile(bytes: number) {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const f = path.join(await mkdtemp(path.join(tmpdir(), "fb-")), "r.mp4");
    await writeFile(f, Buffer.alloc(bytes));
    return f;
  }
  const bodyOf = (call: unknown[]) => String((call[1] as RequestInit).body);

  it("chỉ nhận Reel 3–90 giây", () => {
    expect(() => assertReelDuration(2.9)).toThrow(/3–90/);
    expect(() => assertReelDuration(90.5)).toThrow(/3–90/);
    expect(() => assertReelDuration(60)).not.toThrow();
  });

  it("3 pha: start → upload → finish (đăng ngay)", async () => {
    const f = await tmpFile(1024);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({ video_id: "v1", upload_url: "https://rupload.facebook.com/video-upload/v27.0/v1" }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await publishReelAs(page, f, { description: "Thử", seconds: 60 })).toEqual({ videoId: "v1" });
    const headers = (fetchSpy.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(headers.offset).toBe("0");
    expect(headers.file_size).toBe("1024");
    expect(headers.Authorization).toBe("OAuth pt");
    const finish = bodyOf(fetchSpy.mock.calls[2]);
    expect(finish).toContain("upload_phase=finish");
    expect(finish).toContain("video_id=v1");
    expect(finish).toContain("video_state=PUBLISHED");
  });

  it("hẹn giờ → SCHEDULED + giờ unix", async () => {
    const f = await tmpFile(10);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({ video_id: "v1", upload_url: "https://rupload.facebook.com/x" }))
      .mockResolvedValueOnce(json({ success: true }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetchSpy);
    await publishReelAs(page, f, { description: "x", seconds: 30, scheduledAt: new Date("2026-12-01T01:00:00Z") });
    const finish = bodyOf(fetchSpy.mock.calls[2]);
    expect(finish).toContain("video_state=SCHEDULED");
    expect(finish).toContain("scheduled_publish_time=1796086800");
  });

  it("upload lỗi → ném, không gọi finish", async () => {
    const f = await tmpFile(10);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(json({ video_id: "v1", upload_url: "https://rupload.facebook.com/x" }))
      .mockResolvedValueOnce(json({ error: { message: "boom" } }, 500));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(publishReelAs(page, f, { description: "x", seconds: 30 })).rejects.toThrow(/500/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("Reel quá dài → ném trước khi gọi API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(publishReelAs(page, "khong-co.mp4", { description: "x", seconds: 120 })).rejects.toThrow(/3–90/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("đăng video dài (chia mảnh)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const page = { pageId: PAGE, token: "pt" };
  async function tmpFile(bytes: number) {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const f = path.join(await mkdtemp(path.join(tmpdir(), "fbv-")), "v.mp4");
    await writeFile(f, Buffer.alloc(bytes));
    return f;
  }
  const phase = (call: unknown[]) => {
    const body = (call[1] as RequestInit).body;
    return body instanceof FormData ? String(body.get("upload_phase")) : new URLSearchParams(String(body)).get("upload_phase");
  };
  const chunkSize = (call: unknown[]) => ((call[1] as RequestInit).body as FormData).get("video_file_chunk") as Blob;
  const start = () => json({ upload_session_id: "s1", video_id: "vid", start_offset: "0", end_offset: "1000" });

  it("gửi đủ các mảnh theo offset Facebook trả về rồi finish", async () => {
    const f = await tmpFile(2500);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(start())
      .mockResolvedValueOnce(json({ start_offset: "1000", end_offset: "2000" }))
      .mockResolvedValueOnce(json({ start_offset: "2000", end_offset: "2500" }))
      .mockResolvedValueOnce(json({ start_offset: "2500", end_offset: "2500" }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await publishPageVideoAs(page, f, { title: "T", description: "D" })).toEqual({ videoId: "vid" });
    const transfers = fetchSpy.mock.calls.filter((c) => phase(c) === "transfer");
    expect(transfers).toHaveLength(3);
    expect(chunkSize(transfers[1]).size).toBe(1000);
    expect(chunkSize(transfers[2]).size).toBe(500);
    expect(phase(fetchSpy.mock.calls[4])).toBe("finish");
  });

  it("mảnh lỗi 2 lần rồi được → vẫn xong", async () => {
    const f = await tmpFile(2000);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(start())
      .mockResolvedValueOnce(json({ start_offset: "1000", end_offset: "2000" }))
      .mockResolvedValueOnce(json({ error: { message: "chập" } }, 500))
      .mockResolvedValueOnce(json({ error: { message: "chập" } }, 500))
      .mockResolvedValueOnce(json({ start_offset: "2000", end_offset: "2000" }))
      .mockResolvedValueOnce(json({ success: true }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await publishPageVideoAs(page, f, { title: "T", description: "D" })).toEqual({ videoId: "vid" });
    expect(fetchSpy.mock.calls.filter((c) => phase(c) === "transfer")).toHaveLength(4);
  });

  it("mảnh lỗi quá 3 lần → ném lỗi có số mảnh, không finish", async () => {
    const f = await tmpFile(2000);
    const fail = () => json({ error: { message: "chập" } }, 500);
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(start())
      .mockResolvedValueOnce(json({ start_offset: "1000", end_offset: "2000" }))
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail())
      .mockResolvedValueOnce(fail());
    vi.stubGlobal("fetch", fetchSpy);
    await expect(publishPageVideoAs(page, f, { title: "T", description: "D" })).rejects.toThrow(/mảnh 2/);
    expect(fetchSpy.mock.calls.some((c) => phase(c) === "finish")).toBe(false);
  });
});
