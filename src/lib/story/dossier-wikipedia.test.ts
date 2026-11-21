import { afterEach, describe, expect, it, vi } from "vitest";
import { pickRelatedTitles, RELATED_MAX, RELATED_MAX_CHARS, wikipediaSources } from "./dossier-wikipedia";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const LONG = "x".repeat(20_000);

describe("chọn bài Wikipedia liên quan", () => {
  it("bỏ rác và trang quá rộng, xếp theo số lần nhắc trong bài chính", () => {
    const picked = pickRelatedTitles(
      ["Geographic coordinate system", "938", "Year 938", "ISBN (identifier)", "Vietnam", "Battle of Bạch Đằng (disambiguation)", "Liu Hongcao", "Southern Han", "Ngô Quyền", "Kiều Công Hãn"],
      "Ngô Quyền đánh. Ngô Quyền thắng. Ngô Quyền xưng vương. Southern Han thua. Southern Han rút. Liu Hongcao chết.",
      "Battle of Bạch Đằng (938)",
    );
    expect(picked[0]).toBe("Ngô Quyền");
    expect(picked.slice(0, 3)).toEqual(["Ngô Quyền", "Southern Han", "Liu Hongcao"]);
    for (const junk of ["Geographic coordinate system", "938", "Year 938", "ISBN (identifier)", "Vietnam", "Battle of Bạch Đằng (disambiguation)"])
      expect(picked).not.toContain(junk);
    expect(picked.length).toBeLessThanOrEqual(RELATED_MAX);
    expect(picked).not.toContain("Kiều Công Hãn"); // không được nhắc lần nào trong bài chính
  });
});

describe("nguồn Wikipedia", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** fetch giả theo loại lời gọi: bài chính en, parse links, bài liên quan. */
  function stubWikipedia(linksResponse: () => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.searchParams.get("action") === "parse") return linksResponse();
        const title = u.searchParams.get("titles");
        if (title === "Main") return json({ query: { pages: { "1": { title: "Main", extract: `Ngô Quyền ${LONG}`, fullurl: "https://en.wikipedia.org/wiki/Main" } } } });
        return json({ query: { pages: { "2": { title, extract: LONG, fullurl: `https://en.wikipedia.org/wiki/${title}` } } } });
      }),
    );
  }

  it("có bài chính và bài liên quan (cắt theo trần ký tự)", async () => {
    stubWikipedia(() => json({ parse: { links: [{ ns: 0, "*": "Ngô Quyền" }, { ns: 14, "*": "Category:X" }] } }));
    const { main, related } = await wikipediaSources("Main", async () => {});
    expect(main.map((s) => s.title)).toEqual(["Main"]);
    expect(related.map((s) => s.title)).toEqual(["Ngô Quyền"]);
    expect(related[0]).toMatchObject({ kind: "wikipedia", lang: "en" });
    expect(related[0].text.length).toBeLessThanOrEqual(RELATED_MAX_CHARS);
  });

  it("lấy liên kết lỗi → bỏ lớp liên quan, bài chính vẫn đủ", async () => {
    stubWikipedia(() => new Response("", { status: 500 }));
    const { main, related } = await wikipediaSources("Main", async () => {});
    expect(main).toHaveLength(1);
    expect(related).toEqual([]);
  });
});
