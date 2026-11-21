import { describe, expect, it, vi } from "vitest";
import type { DossierSource } from "./history-types";

const src = (kind: DossierSource["kind"], lang: "vi" | "en", title: string): DossierSource => ({ kind, lang, title, url: `u/${title}`, text: "t".repeat(2000) });

vi.mock("./dossier-wikipedia", () => ({
  MAIN_MAX_CHARS: 40_000,
  wikipediaSources: vi.fn(async () => ({
    main: [src("wikipedia", "vi", "Trận Bạch Đằng (938)"), src("wikipedia", "en", "Battle of Bạch Đằng (938)")],
    related: [src("wikipedia", "en", "Ngô Quyền"), src("wikipedia", "en", "Southern Han")],
  })),
}));
vi.mock("./dossier-wikisource", () => ({
  wikisourceSources: vi.fn(async (q: { lang: string }) => [src("wikisource", q.lang as "vi" | "en", `ws-${q.lang}`)]),
}));
vi.mock("./dossier-web", () => ({
  webSources: vi.fn(async () => {
    throw new Error("mạng chập");
  }),
}));

const { buildDossier, dossierText, topicKeywords } = await import("./dossier");
const { wikisourceSources } = await import("./dossier-wikisource");

describe("điều phối hồ sơ 3 lớp", () => {
  it("thứ tự: Wikipedia chính → Wikisource → web → Wikipedia liên quan; lớp web lỗi vẫn trả các lớp khác", async () => {
    const d = await buildDossier("Battle of Bạch Đằng (938)", async () => {});
    expect(d.sources.map((s) => `${s.kind}:${s.title}`)).toEqual([
      "wikipedia:Trận Bạch Đằng (938)",
      "wikipedia:Battle of Bạch Đằng (938)",
      "wikisource:ws-vi",
      "wikisource:ws-en",
      "wikipedia:Ngô Quyền",
      "wikipedia:Southern Han",
    ]);
  });

  it("Wikisource tiếng Việt tìm theo tên trận + tên nhân vật Việt trong bài liên quan", async () => {
    await buildDossier("Battle of Bạch Đằng (938)", async () => {});
    const calls = vi.mocked(wikisourceSources).mock.calls.map((c) => c[0]);
    const viQuery = calls.find((q) => q.lang === "vi")!;
    expect(viQuery.keywords).toContain("Bạch Đằng");
    expect(viQuery.keywords).toContain("Ngô Quyền");
    expect(viQuery.search).toContain("Ngô Quyền");
  });

  it("đầu mục hồ sơ ghi loại nguồn", async () => {
    const d = await buildDossier("Battle of Bạch Đằng (938)", async () => {});
    expect(dossierText(d)).toContain("### wikisource · vi — ws-vi (u/ws-vi)");
  });
});

describe("từ khoá đề tài", () => {
  it("bỏ chữ chung (Trận/Battle of…) và phần trong ngoặc", () => {
    expect(topicKeywords("Trận Bạch Đằng (938)")).toEqual(["Bạch Đằng"]);
    expect(topicKeywords("Battle of Thermopylae")).toEqual(["Thermopylae"]);
    expect(topicKeywords("Hannibal's crossing of the Alps")).toEqual(["Alps", "Hannibal"]);
    expect(topicKeywords("Genghis Khan")).toEqual(["Genghis Khan"]);
    expect(topicKeywords("Khởi nghĩa Lam Sơn")).toEqual(["Lam Sơn"]);
  });
});
