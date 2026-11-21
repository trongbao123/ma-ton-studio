import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDossier, DOSSIER_MAX_CHARS_PER_SOURCE, dossierText } from "./dossier";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
/** Bài đủ dài để qua ngưỡng hồ sơ tối thiểu. */
const LONG = "x".repeat(4000);
const page = (o: Record<string, unknown>) => json({ query: { pages: { "1": { pageid: 1, ...o } } } });

/** fetch giả theo host: en.wikipedia.org / vi.wikipedia.org. */
function wiki(en: Response, viPage?: Response) {
  return vi.fn(async (url: string) => (String(url).includes("://vi.") ? viPage! : en));
}

describe("hồ sơ tư liệu Wikipedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("lấy bài tiếng Anh + bài tiếng Việt qua langlink, tiếng Việt đứng trước, kèm URL", async () => {
    const fetchSpy = wiki(
      page({ title: "Battle of Bạch Đằng (938)", extract: `EN text ${LONG}`, fullurl: "https://en.wikipedia.org/wiki/Battle_of_B", langlinks: [{ lang: "vi", "*": "Trận Bạch Đằng (938)" }] }),
      page({ title: "Trận Bạch Đằng (938)", extract: `VI text ${LONG}`, fullurl: "https://vi.wikipedia.org/wiki/Tran" }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const d = await buildDossier("Battle of Bạch Đằng (938)");
    expect(d.sources.map((s) => s.lang)).toEqual(["vi", "en"]);
    expect(d.sources[0]).toMatchObject({ title: "Trận Bạch Đằng (938)", url: "https://vi.wikipedia.org/wiki/Tran", text: `VI text ${LONG}` });
    const [enUrl, enInit] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(enUrl).toContain("redirects=1");
    expect((enInit.headers as Record<string, string>)["User-Agent"]).toContain("ma-ton-studio");
    expect(dossierText(d)).toContain("### wikipedia · vi — Trận Bạch Đằng (938) (https://vi.wikipedia.org/wiki/Tran)");
  });

  it("bài tiếng Anh không tồn tại → báo rõ tên đề tài, không gọi tiếp", async () => {
    const fetchSpy = wiki(page({ title: "Không có", missing: "" }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(buildDossier("Không có")).rejects.toThrow(/Không tìm thấy bài Wikipedia "Không có"/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("không có bài tiếng Việt → hồ sơ chỉ tiếng Anh", async () => {
    vi.stubGlobal("fetch", wiki(page({ title: "X", extract: LONG, fullurl: "u" })));
    expect((await buildDossier("X")).sources.map((s) => s.lang)).toEqual(["en"]);
  });

  it("bỏ phần tham khảo/liên kết ngoài, cắt ở ranh giới đoạn khi quá dài", async () => {
    const paragraph = "a".repeat(999);
    const long = Array.from({ length: 50 }, () => paragraph).join("\n\n");
    vi.stubGlobal("fetch", wiki(page({ title: "X", fullurl: "u", extract: `${long}\n\n== References ==\nNGUON_RAC` })));
    const { text } = (await buildDossier("X")).sources[0];
    expect(text).not.toContain("NGUON_RAC");
    expect(text.length).toBeLessThanOrEqual(DOSSIER_MAX_CHARS_PER_SOURCE);
    expect(text.endsWith(paragraph)).toBe(true);
  });

  it("Wikipedia báo 429 (quá nhanh) → chờ rồi thử lại", async () => {
    const tooMany = () => new Response("", { status: 429, headers: { "Retry-After": "2" } });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(tooMany())
      .mockResolvedValueOnce(page({ title: "X", extract: LONG, fullurl: "u" }));
    vi.stubGlobal("fetch", fetchSpy);
    const sleep = vi.fn(async () => {});
    expect((await buildDossier("X", sleep)).sources).toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("mục 'Sources' / mục con '=== Notes ===' giữa bài (bàn về sử liệu) không bị cắt", async () => {
    const extract = [
      `Mở đầu. ${LONG}`,
      "== Sources ==\nHerodotus là nguồn chính.",
      "=== Notes ===\nGhi chú giữa bài.",
      "== Battle ==\nDIEN_BIEN",
      "== References ==\nNGUON_RAC",
    ].join("\n\n");
    vi.stubGlobal("fetch", wiki(page({ title: "X", fullurl: "u", extract })));
    const { text } = (await buildDossier("X")).sources[0];
    expect(text).toContain("Herodotus");
    expect(text).toContain("DIEN_BIEN");
    expect(text).not.toContain("NGUON_RAC");
  });

  it("tiêu đề không hợp lệ (invalid) → báo như không tìm thấy", async () => {
    vi.stubGlobal("fetch", wiki(page({ title: "A|B", invalid: "" })));
    await expect(buildDossier("A|B")).rejects.toThrow(/Không tìm thấy bài Wikipedia/);
  });

  it("hồ sơ quá mỏng (trang trống / định hướng) → báo lỗi, không viết từ hồ sơ rỗng", async () => {
    vi.stubGlobal("fetch", wiki(page({ title: "X", extract: "Ngắn.", fullurl: "u" })));
    await expect(buildDossier("X")).rejects.toThrow(/quá ít tư liệu/);
  });
});
