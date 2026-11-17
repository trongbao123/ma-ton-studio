import { describe, expect, it } from "vitest";
import type { Chapter, Series } from "@/db/schema";
import { RECENT_SUMMARY_WINDOW, chapterPrompt, continuePrompt, dropRepeatedParagraphs, isLongChapter, maxContinues, openerLine, outlinePrompt, storyContext } from "./prompts";

const s: Series = {
  id: 1,
  title: "Ma Tôn Trùng Sinh",
  genre: "tiên hiệp",
  premise: "Ma tôn trùng sinh báo thù.",
  bible: "Cảnh giới: Luyện Khí → Trúc Cơ → Kim Đan.",
  style: "ngôi thứ nhất",
  targetWords: 3000,
  autopilot: false,
  autoApprove: false, channel: "main",
  chaptersPerDay: 2,
  episodeChapters: 0,
  voiceStyle: "",
  ttsVoice: "Algenib",
  makeShort: true,
  autoPublish: true,
  createdAt: new Date(0),
};

const ch = (number: number, summary = `tóm tắt ${number}`): Chapter => ({
  id: number,
  seriesId: 1,
  number,
  title: `Chương ${number}`,
  outline: `dàn ý ${number}`,
  content: "",
  summary,
  status: "draft",
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe("storyContext", () => {
  it("báo là phần mở đầu khi chưa có chương", () => {
    expect(storyContext(s, [])).toContain("Chưa có chương nào");
  });

  it("chỉ giữ tóm tắt của các chương gần nhất, bỏ chương chưa có tóm tắt", () => {
    const list = Array.from({ length: RECENT_SUMMARY_WINDOW + 5 }, (_, i) => ch(i + 1));
    list.push(ch(99, ""));
    const ctx = storyContext(s, list);
    expect(ctx).not.toContain("tóm tắt 5\n");
    expect(ctx).toContain("tóm tắt 6");
    expect(ctx).toContain(`tóm tắt ${RECENT_SUMMARY_WINDOW + 5}`);
    expect(ctx).not.toContain("Chương 99");
  });
});

describe("outlinePrompt", () => {
  it("đánh số nối tiếp chương cuối", () => {
    expect(outlinePrompt(s, [ch(1), ch(2)], 5).prompt).toContain("từ chương 3 đến chương 7");
    expect(outlinePrompt(s, [], 10).prompt).toContain("từ chương 1 đến chương 10");
  });

  it("chỉ chèn xu hướng khi có", () => {
    expect(outlinePrompt(s, [], 5).prompt).not.toContain("Xu hướng khán giả");
    expect(outlinePrompt(s, [], 5, "- Chủ đề đang hot: trùng sinh").prompt).toContain("Xu hướng khán giả hiện tại");
  });
});

describe("chapterPrompt", () => {
  it("đưa dàn ý, độ dài và giọng văn vào prompt", () => {
    const p = chapterPrompt(s, [ch(1)], ch(2));
    expect(p.prompt).toContain("dàn ý 2");
    expect(p.prompt).toContain("3000 từ");
    expect(p.system).toContain("ngôi thứ nhất");
  });
});

describe("chương dài (tập dài mỗi ngày)", () => {
  const long: Series = { ...s, targetWords: 7000 };
  const words = (n: number) => Array.from({ length: n }, (_, i) => `từ${i}`).join(" ");

  it("chỉ chương ≥ 5000 từ mới viết nhiều lượt, cho phép nhiều lượt tiếp hơn", () => {
    expect(isLongChapter(3500)).toBe(false);
    expect(isLongChapter(7000)).toBe(true);
    expect(maxContinues(3500)).toBe(2);
    expect(maxContinues(7000)).toBe(5);
  });

  it("lượt đầu chương dài chỉ viết phần đầu, không kết chương", () => {
    const p = chapterPrompt(long, [], ch(1), { partial: true }).prompt;
    expect(p).toContain("CHỈ viết phần đầu");
    expect(p).toContain("KHÔNG cliffhanger");
    expect(chapterPrompt(long, [], ch(1)).prompt).not.toContain("CHỈ viết phần đầu");
    expect(chapterPrompt(s, [], ch(1), { partial: true }).prompt).not.toContain("CHỈ viết phần đầu");
  });

  it("viết tiếp: còn nhiều thì dừng giữa mạch, còn ít mới kết cliffhanger", () => {
    const base = chapterPrompt(long, [], ch(1));
    expect(continuePrompt(base, words(3000), 7000).prompt).toContain("CHƯA kết");
    expect(continuePrompt(base, words(6000), 7000).prompt).toContain("kết bằng cliffhanger");
    expect(continuePrompt(chapterPrompt(s, [], ch(1)), words(1000), 3000).prompt).toContain("kết bằng cliffhanger");
  });

  it("bỏ đoạn AI chép lại nguyên văn, giữ thoại ngắn trùng", () => {
    const para = "Hắn đứng giữa đại điện, ánh mắt lạnh như băng, sát khí cuộn trào khiến toàn bộ đám đông nín thở.";
    const written = `Mở đầu.\n\n${para}\n\n"Được."`;
    const part = `${para}\n\n"Được."\n\nĐoạn mới hoàn toàn.`;
    expect(dropRepeatedParagraphs(written, part)).toBe('"Được."\n\nĐoạn mới hoàn toàn.');
  });
});

describe("biblePrompt", () => {
  it("lồng khung cấu trúc 3 bộ hit kèm luật không chép", async () => {
    const { biblePrompt, HIT_FORMULA } = await import("./prompts");
    const p = biblePrompt("phế vật thức tỉnh", "tiên hiệp").prompt;
    expect(p).toContain(HIT_FORMULA);
    expect(p).toContain("Kiểu Đấu La Đại Lục");
    expect(p).toContain("KHÔNG đi lại chuỗi tình tiết");
  });
});

describe("openerLine", () => {
  it("liệt kê đúng chương mở tập trong khoảng dàn ý (tập 3 chương)", () => {
    expect(openerLine({ episodeChapters: 3 }, 16, 7)).toContain("Chương 16, 19, 22 là chương MỞ ĐẦU TẬP");
  });
  it("không chế độ tập thì rỗng", () => {
    expect(openerLine({ episodeChapters: 0 }, 16, 7)).toBe("");
  });
});

describe("luật mở đầu kiểu truyện hệ thống", () => {
  it("prompt chương có đủ luật mở đầu và bỏ luật tả giác quan", async () => {
    const { OPENING_RULES } = await import("./prompts");
    const p = chapterPrompt(s, [ch(1)], ch(2));
    expect(OPENING_RULES).toHaveLength(6);
    for (const rule of OPENING_RULES) expect(p.system + p.prompt).toContain(rule);
    expect(p.prompt).not.toContain("mùi máu, tiếng xương gãy");
    expect(p.prompt).not.toContain("Tả bằng giác quan");
  });
  it("mẫu học là truyện audio hệ thống, không còn nêu tên 3 bộ truyện chữ", () => {
    expect(chapterPrompt(s, [], ch(1)).system).not.toMatch(/Đấu La|Thôn Phệ Tinh Không|Quang Âm Chi Ngoại/);
  });
  it("chương mở tập: câu đầu là thông báo bàn tay vàng hoặc thoại xung đột", () => {
    expect(openerLine({ episodeChapters: 3 }, 1, 3)).toMatch(/câu đầu tiên/i);
  });
});

describe("tập 1 — 1 giờ đầu phải cuốn (khuôn hook Tiểu Hồ Review)", () => {
  it("chương 1–3 nhận đủ luật tập 1, chương 4 thì không", async () => {
    const { FIRST_HOUR_RULES } = await import("./prompts");
    const p1 = chapterPrompt(s, [], ch(1)).prompt;
    expect(p1).toContain("1 GIỜ ĐẦU PHẢI CUỐN");
    for (const r of FIRST_HOUR_RULES) expect(p1).toContain(r);
    expect(chapterPrompt(s, [], ch(3)).prompt).toContain("Ta tên");
    expect(chapterPrompt(s, [], ch(4)).prompt).not.toContain("1 GIỜ ĐẦU PHẢI CUỐN");
  });
  it("dàn ý chỉ liệt kê chương thuộc tập 1", () => {
    expect(outlinePrompt(s, [], 10).prompt).toContain("TẬP 1 (chương 1, 2, 3)");
    expect(outlinePrompt(s, [ch(1), ch(2)], 10).prompt).toContain("TẬP 1 (chương 3)");
    expect(outlinePrompt(s, [ch(1), ch(2), ch(3)], 10).prompt).not.toContain("TẬP 1 (");
  });
  it("ngôi 'Ta' đi vào system prompt khi bộ dùng FIRST_PERSON_STYLE", async () => {
    const { FIRST_PERSON_STYLE } = await import("./prompts");
    expect(chapterPrompt({ ...s, style: FIRST_PERSON_STYLE }, [], ch(5)).system).toContain("xưng 'ta'");
  });
});
