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
  autoApprove: false,
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
