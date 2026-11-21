import { afterEach, describe, expect, it, vi } from "vitest";
import { excerptAround, WIKISOURCE_MAX_CHARS, wikisourceSources } from "./dossier-wikisource";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

describe("đoạn quanh từ khoá", () => {
  it("lấy cửa sổ quanh từ khoá ở giữa trang dài, không lấy đầu trang", () => {
    const text = `${"a".repeat(3000)} Ngô Quyền đóng cọc ở Bạch Đằng ${"b".repeat(3000)}`;
    const out = excerptAround(text, { topic: ["Bạch Đằng"], extra: [] }, 6000);
    expect(out).toContain("Bạch Đằng");
    expect(out.length).toBeLessThan(3200);
    expect(out.startsWith("a".repeat(3000))).toBe(false);
  });
  it("chỉ nhận đoạn có cụm chính, hoặc có từ đề tài + thêm một từ khoá khác; khớp theo ranh giới từ", () => {
    const terms = { topic: ["Battle of Hastings", "Hastings"], extra: [] };
    expect(excerptAround("Warren Hastings bị luận tội ở London.", terms, 6000)).toBe("");
    expect(excerptAround("Năm 1066, Battle of Hastings diễn ra.", terms, 6000)).toContain("Battle of Hastings");
    const viTerms = { topic: ["Trận Bạch Đằng", "Bạch Đằng", "938"], extra: ["Ngô Quyền", "Đại Việt", "Thăng Long"] };
    expect(excerptAround("Vua ngự ở Thăng Long, nước Đại Việt yên ổn.", viTerms, 6000)).toBe("");
    expect(excerptAround("Ngô Quyền đóng cọc ở sông Bạch Đằng.", viTerms, 6000)).toContain("Ngô Quyền");
    expect(excerptAround("Nhà Qing suy yếu.", { topic: ["Qin's wars", "Qin"], extra: ["unification"] }, 6000)).toBe("");
  });
  it("không có từ khoá → rỗng", () => {
    expect(excerptAround("không liên quan", { topic: ["Bạch Đằng"], extra: [] }, 6000)).toBe("");
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
    const sources = await wikisourceSources({ lang: "vi", search: "Bạch Đằng", terms: { topic: ["Bạch Đằng"], extra: [] }, maxPages: 3 }, async () => {});
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: "wikisource", lang: "vi", title: "Đại Việt sử ký toàn thư/Tập II/Cuốn thứ năm/Ngô sứ quân" });
    expect(sources[0].url).toMatch(/^https:\/\/vi\.wikisource\.org\/wiki\//);
    expect(sources[0].text).toContain("Bạch Đằng");
    expect(sources[0].text.length).toBeLessThanOrEqual(WIKISOURCE_MAX_CHARS);
  });

  it("lỗi mạng → trả rỗng, không ném", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    expect(await wikisourceSources({ lang: "en", search: "Thermopylae", terms: { topic: ["Thermopylae"], extra: [] }, maxPages: 3 }, async () => {})).toEqual([]);
  });

  it("tiếng Anh chỉ nhận sử gia cổ / bách khoa, loại kịch, thơ, tiểu thuyết", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        if (u.searchParams.get("list") === "search")
          return json({ query: { search: [{ title: "The Tragedy of Julius Caesar (1916) Yale/Act III" }, { title: "War and Peace/Book Nine" }, { title: "Lives of the Twelve Caesars/Julius Caesar" }] } });
        return json({ parse: { text: "<p>Julius Caesar was assassinated on the Ides of March by Brutus and Cassius.</p>" } });
      }),
    );
    const sources = await wikisourceSources({ lang: "en", search: "Julius Caesar", terms: { topic: ["Julius Caesar"], extra: [] }, maxPages: 3 }, async () => {});
    expect(sources.map((s) => s.title)).toEqual(["Lives of the Twelve Caesars/Julius Caesar"]);
  });
});
