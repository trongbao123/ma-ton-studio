import { afterEach, describe, expect, it, vi } from "vitest";
import { excerptAround, WIKISOURCE_MAX_CHARS, wikisourceSources } from "./dossier-wikisource";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("đoạn quanh từ khoá", () => {
  it("lấy cửa sổ quanh từ khoá ở giữa trang dài, không lấy đầu trang", () => {
    const text = `${"a".repeat(3000)} Ngô Quyền đóng cọc ở Bạch Đằng ${"b".repeat(3000)}`;
    const out = excerptAround(text, ["bạch đằng"], 6000);
    expect(out).toContain("Bạch Đằng");
    expect(out.length).toBeLessThan(3200);
    expect(out.startsWith("a".repeat(3000))).toBe(false);
  });
  it("không có từ khoá → rỗng", () => {
    expect(excerptAround("không liên quan", ["bạch đằng"], 6000)).toBe("");
  });
});

describe("nguồn Wikisource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("tiếng Việt chỉ nhận các bộ sử, bỏ tiểu thuyết; trả đoạn quanh từ khoá kèm URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.searchParams.get("list") === "search")
          return json({ query: { search: [{ title: "Nam cực tinh huy/Hồi 14" }, { title: "Đại Việt sử ký toàn thư/Tập II/Cuốn thứ năm/Ngô sứ quân" }] } });
        return json({ parse: { text: `<p>${"x".repeat(2000)} Trận Bạch Đằng năm Mậu Tuất ${"y".repeat(2000)}</p>` } });
      }),
    );
    const sources = await wikisourceSources({ lang: "vi", search: "Bạch Đằng", keywords: ["Bạch Đằng"] }, async () => {});
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "wikisource", lang: "vi", title: "Đại Việt sử ký toàn thư/Tập II/Cuốn thứ năm/Ngô sứ quân" });
    expect(sources[0].url).toMatch(/^https:\/\/vi\.wikisource\.org\/wiki\//);
    expect(sources[0].text).toContain("Bạch Đằng");
    expect(sources[0].text.length).toBeLessThanOrEqual(WIKISOURCE_MAX_CHARS);
  });

  it("lỗi mạng → trả rỗng, không ném", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await wikisourceSources({ lang: "en", search: "Thermopylae", keywords: ["Thermopylae"] }, async () => {})).toEqual([]);
  });
});
