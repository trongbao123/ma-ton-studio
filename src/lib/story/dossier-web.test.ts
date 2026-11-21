import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTrustedUrl, TRUSTED_DOMAINS, WEB_MAX_CHARS, webSources } from "./dossier-web";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("tên miền tin cậy", () => {
  it("nhận tên miền và tên miền con trong danh sách, chặn tên miền giả mạo", () => {
    expect(isTrustedUrl("https://www.britannica.com/event/Battle")).toBe(true);
    expect(isTrustedUrl("https://vnexpress.net/a.html")).toBe(true);
    expect(isTrustedUrl("https://evil.com/britannica.com")).toBe(false);
    expect(isTrustedUrl("https://notbritannica.com/x")).toBe(false);
    expect(isTrustedUrl("không phải url")).toBe(false);
  });
});

describe("nguồn web qua Tavily", () => {
  const saved = process.env.TAVILY_API_KEY;
  beforeEach(() => delete process.env.TAVILY_API_KEY);
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.TAVILY_API_KEY = saved;
  });

  it("không có key → bỏ lớp web, không gọi mạng", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await webSources("Battle of Waterloo")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("có key → chỉ tìm trong tên miền tin cậy, loại trang lạ, cắt độ dài, nhận biết trang Việt", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    const fetchSpy = vi.fn().mockResolvedValueOnce(
      json({
        results: [
          { title: "Waterloo", url: "https://www.britannica.com/event/Battle-of-Waterloo", content: "ngắn", raw_content: "w".repeat(20_000) },
          { title: "Lạ", url: "https://evil.com/x", content: "c".repeat(2000) },
          { title: "Trận", url: "https://vnexpress.net/tran.html", content: "v".repeat(1000) },
          { title: "Quá ngắn", url: "https://www.history.com/x", content: "abc" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const sources = await webSources("Battle of Waterloo");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tvly-test");
    expect(JSON.parse(String(init.body)).include_domains).toEqual(TRUSTED_DOMAINS);
    expect(sources.map((s) => s.url)).toEqual(["https://www.britannica.com/event/Battle-of-Waterloo", "https://vnexpress.net/tran.html"]);
    expect(sources[0]).toMatchObject({ kind: "web", lang: "en" });
    expect(sources[0].text.length).toBeLessThanOrEqual(WEB_MAX_CHARS);
    expect(sources[1].lang).toBe("vi");
  });

  it("Tavily lỗi → rỗng, không ném", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    expect(await webSources("x")).toEqual([]);
  });
});
