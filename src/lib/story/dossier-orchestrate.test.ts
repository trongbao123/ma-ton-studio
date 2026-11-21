import { describe, expect, it, vi } from "vitest";
import type { DossierSource } from "./history-types";

const src = (kind: DossierSource["kind"], lang: "vi" | "en", title: string): DossierSource => ({ kind, lang, title, url: `u/${title}`, text: "t".repeat(2000) });

vi.mock("./dossier-wikipedia", () => ({
  MAIN_MAX_CHARS: 40_000,
  isBroadTitle: (t: string) => ["russia", "vietnam", "china"].includes(t.toLowerCase()),
  wikipediaSources: vi.fn(async () => ({
    main: [src("wikipedia", "vi", "Trận Bạch Đằng (938)"), src("wikipedia", "en", "Battle of Bạch Đằng (938)")],
    related: [src("wikipedia", "en", "Ngô Quyền"), src("wikipedia", "en", "Southern Han")],
  })),
}));
vi.mock("./dossier-wikisource", () => ({
  WIKISOURCE_MAX_PAGES: 3,
  // Mỗi lượt trả 3 trang → tổng Wikisource (vi + en) vẫn chỉ 3 trang.
  wikisourceSources: vi.fn(async (q: { lang: string; maxPages: number }) =>
    Array.from({ length: q.maxPages }, (_, i) => src("wikisource", q.lang as "vi" | "en", i ? `ws-${q.lang}-${i}` : `ws-${q.lang}`)),
  ),
}));
vi.mock("./dossier-web", () => ({
  webSources: vi.fn(async () => {
    throw new Error("mạng chập");
  }),
}));

const { buildDossier, dossierText, topicTerms } = await import("./dossier");
const { wikisourceSources } = await import("./dossier-wikisource");

describe("điều phối hồ sơ 3 lớp", () => {
  it("thứ tự: Wikipedia chính → Wikisource → web → Wikipedia liên quan; lớp web lỗi vẫn trả các lớp khác", async () => {
    const d = await buildDossier("Battle of Bạch Đằng (938)", async () => {});
    expect(d.sources.map((s) => `${s.kind}:${s.title}`)).toEqual([
      "wikipedia:Trận Bạch Đằng (938)",
      "wikipedia:Battle of Bạch Đằng (938)",
      "wikisource:ws-vi",
      "wikisource:ws-vi-1",
      "wikisource:ws-vi-2",
      "wikipedia:Ngô Quyền",
      "wikipedia:Southern Han",
    ]);
  });

  it("Wikisource tiếng Việt tìm theo tên trận + tên nhân vật Việt trong bài liên quan", async () => {
    await buildDossier("Battle of Bạch Đằng (938)", async () => {});
    const calls = vi.mocked(wikisourceSources).mock.calls.map((c) => c[0]);
    const viQuery = calls.find((q) => q.lang === "vi")!;
    expect(viQuery.terms.topic).toContain("Bạch Đằng");
    expect(viQuery.terms.extra).toContain("Ngô Quyền");
    expect(viQuery.search).toContain("Ngô Quyền");
  });

  it("đầu mục hồ sơ ghi loại nguồn", async () => {
    const d = await buildDossier("Battle of Bạch Đằng (938)", async () => {});
    expect(dossierText(d)).toContain("### wikisource · vi — ws-vi (u/ws-vi)");
  });
});

describe("từ khoá đề tài", () => {
  it("giữ cụm đầy đủ làm từ khoá chính, bỏ chữ chung/trang rộng/từ quá ngắn, giữ năm trong ngoặc", () => {
    expect(topicTerms("Trận Bạch Đằng (938)")).toEqual(["Trận Bạch Đằng", "Bạch Đằng", "938"]);
    expect(topicTerms("Battle of Hastings")).toEqual(["Battle of Hastings", "Hastings"]);
    expect(topicTerms("French invasion of Russia")).toEqual(["French invasion of Russia"]);
    expect(topicTerms("Hannibal's crossing of the Alps")).toEqual(["Hannibal's crossing of the Alps", "Alps", "Hannibal"]);
    expect(topicTerms("Qin's wars of unification")).toEqual(["Qin's wars of unification", "unification"]);
    expect(topicTerms("Genghis Khan")).toEqual(["Genghis Khan"]);
  });
});
