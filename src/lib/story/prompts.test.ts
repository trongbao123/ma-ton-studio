import { describe, expect, it } from "vitest";
import type { Chapter, Series } from "@/db/schema";
import { RECENT_SUMMARY_WINDOW, chapterPrompt, outlinePrompt, storyContext } from "./prompts";

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
