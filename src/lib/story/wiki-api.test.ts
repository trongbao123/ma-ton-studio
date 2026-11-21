import { afterEach, describe, expect, it, vi } from "vitest";
import { htmlToText, wikiApi } from "./wiki-api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("gọi MediaWiki", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("gắn User-Agent, format=json, tham số truyền vào", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(json({ ok: 1 }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await wikiApi("vi.wikisource.org", { action: "parse", page: "A B" })).toEqual({ ok: 1 });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/vi\.wikisource\.org\/w\/api\.php\?/);
    expect(url).toContain("format=json");
    expect(url).toContain("page=A+B");
    expect((init.headers as Record<string, string>)["User-Agent"]).toContain("ma-ton-studio");
  });

  it("429 → chờ theo Retry-After rồi thử lại; lỗi khác → ném có tên host", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "3" } }))
      .mockResolvedValueOnce(json({ ok: 1 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchSpy);
    const sleep = vi.fn(async () => {});
    expect(await wikiApi("en.wikipedia.org", {}, sleep)).toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(3000);
    await expect(wikiApi("en.wikipedia.org", {}, sleep)).rejects.toThrow(/en\.wikipedia\.org lỗi 503/);
  });
});

describe("HTML → chữ", () => {
  it("bỏ script/thẻ, giữ xuống dòng, giải mã entity", () => {
    expect(htmlToText("<p>A &amp; B</p><script>x</script><br>C&#272;&nbsp;")).toBe("A & B\nCĐ");
  });
  it("entity hex, entity số hỏng không làm sập; bỏ [sửa] và số chú thích; ô bảng cách nhau", () => {
    expect(htmlToText("A&#x110;B&#99999999;C")).toBe("AĐBC");
    expect(htmlToText('Trận<sup class="reference">[1]</sup> diễn ra<span class="mw-editsection">[sửa]</span>')).toBe("Trận diễn ra");
    expect(htmlToText("<td>Năm</td><td>938</td>")).toBe("Năm 938");
  });
});
