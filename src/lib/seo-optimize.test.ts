import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoMeta } from "@/db/schema";

const generateJson = vi.fn();
vi.mock("@/lib/ai", () => ({
  textProvider: () => ({ generateJson }),
  QuotaExhaustedError: class extends Error {},
}));

const { AI_NOTE, optimizeMeta } = await import("./seo-optimize");
const { scoreMeta, seoFeedback, totalScore } = await import("@/lib/flow/seo");

const ctx = { seriesTitle: "Thần Ma Táng Cổ: Thôn Thiên Lục", chapterNumber: 2, chapterTitle: "Rèn đúc" };
const weak: VideoMeta = {
  title: "SÁT Ý BÙNG NỔ",
  description: `Hay lắm.\n\n${AI_NOTE}`,
  tags: ["a"],
  shortTitle: "Đoạn hay",
  shortDescription: "",
  seo: { titleScore: 40 },
};
const tags = [
  "than ma tang co", "thon thien luc", "truyen tien hiep", "lam uyen", "truyen audio", "tien hiep",
  "truyen audio tien hiep hay nhat", "nghe truyen tien hiep moi nhat", "than an thon phe", "co than huyet mach",
  "truyen kiem hiep", "doc truyen tien hiep", "audiobook viet nam", "truyen tien hiep full",
];
const strong = {
  title: "Thần Ma Táng Cổ - Chương 2: Lâm Uyên rèn đúc, thần ấn thôn phệ",
  description: [
    `Thần Ma Táng Cổ chương 2: Lâm Uyên rèn đúc giữa vòng vây. ${"Truyện tiên hiệp audio kịch tính, tiên hiệp, lâm uyên, thần ấn thôn phệ, cổ thần huyết mạch. ".repeat(18)}`,
    "Đăng ký kênh và bấm like để nghe Thần Ma Táng Cổ, Thôn Thiên Lục mỗi ngày — truyện audio, audiobook việt nam, truyện kiếm hiệp, đọc truyện tiên hiệp, truyện tiên hiệp full.",
    "#truyenaudio #tienhiep #thanmatangco",
  ].join("\n\n"),
  tags,
  shortTitle: "Thần Ma Táng Cổ: Lâm Uyên bóp nát tay #shorts",
  shortDescription: "Xem full Thần Ma Táng Cổ trên kênh #shorts",
};

beforeEach(() => generateJson.mockReset());

describe("optimizeMeta", () => {
  it("điểm thấp → AI sửa theo tiêu chí mất điểm, dừng khi ≥ 90, giữ dòng ghi chú AI, bỏ điểm vidIQ cũ", async () => {
    generateJson.mockResolvedValueOnce(strong);
    const r = await optimizeMeta(weak, ctx);
    expect(r.from).toBeLessThan(50);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.rounds).toBe(1);
    expect(r.meta.description.endsWith(AI_NOTE)).toBe(true);
    expect(r.meta.description.split(AI_NOTE)).toHaveLength(2);
    expect(r.meta.seo?.titleScore).toBeNull();
    const prompt = generateJson.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Thiếu tên truyện");
    expect(prompt).not.toContain(AI_NOTE);
  });
  it("đã đạt thì không gọi AI", async () => {
    const good = { ...strong, description: `${strong.description}\n\n${AI_NOTE}` };
    const r = await optimizeMeta(good, ctx);
    expect(r.rounds).toBe(0);
    expect(generateJson).not.toHaveBeenCalled();
  });
  it("AI trả bản kém hơn thì giữ bản cũ, tối đa 3 lượt", async () => {
    generateJson.mockResolvedValue({ title: "x", description: "y", tags: [], shortTitle: "z", shortDescription: "" });
    const r = await optimizeMeta(weak, ctx);
    expect(r.rounds).toBe(3);
    expect(r.meta).toEqual(weak);
  });
});

describe("totalScore / seoFeedback", () => {
  it("chỉ liệt kê tiêu chí chưa đạt", () => {
    const s = scoreMeta(weak, ctx.seriesTitle);
    expect(totalScore(s)).toBeLessThan(60);
    expect(seoFeedback(s)).toContain("Mô tả");
  });
});
