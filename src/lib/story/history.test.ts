import { describe, expect, it } from "vitest";
import type { Chapter, Series } from "@/db/schema";
import {
  HISTORY_PART_WORDS,
  HISTORY_PILOT,
  historyChapterPrompt,
  historyIsFinalPart,
  isSensitiveTopic,
  pickChapterToWrite,
  historyTopicStatus,
  HISTORY_STATUS_LABEL,
  validateHistoryTopic,
  approvalBlockedReason,
  historyScriptComplete,
  topicOutline,
  wikiTitleOf,
} from "./history";

const series = { id: 1, title: "Sử Ký Kể Chuyện", genre: "Lịch sử", bible: "Kênh lịch sử", style: "" } as Series;
const chapter = { id: 1, number: 1, title: HISTORY_PILOT[0].title, outline: topicOutline(HISTORY_PILOT[0]) } as Chapter;

describe("đề tài kênh lịch sử", () => {
  it("20 đề tài khởi đầu, không đề tài nào nhạy cảm, đều có dòng Wikipedia", () => {
    expect(HISTORY_PILOT).toHaveLength(20);
    for (const t of HISTORY_PILOT) {
      expect(isSensitiveTopic(`${t.title}\n${topicOutline(t)}`)).toBe(false);
      expect(wikiTitleOf(topicOutline(t))).toBe(t.wiki);
    }
    expect(wikiTitleOf(topicOutline(HISTORY_PILOT[0]))).toBe("Battle of Ngọc Hồi-Đống Đa");
    expect(wikiTitleOf("không có")).toBeNull();
  });

  it("lọc đề tài nhạy cảm: sau 1945, biển đảo, biên giới 1979, xung đột hiện đại", () => {
    expect(isSensitiveTopic("Trận Điện Biên Phủ 1954")).toBe(true);
    expect(isSensitiveTopic("Hải chiến Hoàng Sa")).toBe(true);
    expect(isSensitiveTopic("Chiến tranh biên giới 1979")).toBe(true);
    expect(isSensitiveTopic("xung dot Gaza")).toBe(true);
    expect(isSensitiveTopic("Trận Bạch Đằng 1288")).toBe(false);
    expect(isSensitiveTopic("Đắm tàu Titanic 1912")).toBe(false);
  });
});

describe("prompt viết kịch bản lịch sử", () => {
  it("đưa nguyên hồ sơ vào prompt, có luật không hư cấu, không dùng luật hư cấu của chuyện đời", () => {
    const p = historyChapterPrompt(series, chapter, "HỒ SƠ MẪU 938");
    expect(p.prompt).toContain("HỒ SƠ MẪU 938");
    expect(p.prompt).toContain(String(HISTORY_PART_WORDS));
    expect(`${p.system}\n${p.prompt}`).toMatch(/không hư cấu/i);
    expect(p.system).not.toContain("HOÀN TOÀN HƯ CẤU");
  });

  it("lượt cuối khi phần còn thiếu vừa một lượt", () => {
    expect(historyIsFinalPart(5000)).toBe(true);
    expect(historyIsFinalPart(2500)).toBe(false);
  });
});

describe("chọn đề tài để viết", () => {
  it("bỏ qua đề tài 'chờ sửa' (có fact_issues) và chương đã viết", () => {
    const list = [
      { id: 1, status: "draft", factIssues: null },
      { id: 2, status: "outline", factIssues: [{ quote: "x" }] },
      { id: 3, status: "outline", factIssues: null },
    ];
    expect(pickChapterToWrite(list)?.id).toBe(3);
    expect(pickChapterToWrite([{ id: 2, status: "outline", factIssues: [{}] }])).toBeUndefined();
  });
});

describe("sửa sau review đợt 2", () => {
  it("dòng Wikipedia có gạch đầu dòng/khoảng trắng vẫn nhận", () => {
    expect(wikiTitleOf("Mở đầu\n- Wikipedia: Battle of Hastings")).toBe("Battle of Hastings");
    expect(wikiTitleOf("  • Wikipedia: Genghis Khan  ")).toBe("Genghis Khan");
  });
  it("không bắt nhầm từ thường: đại loạn, biến động, số quân 2000", () => {
    expect(isSensitiveTopic("Thiên hạ đại loạn cuối thời Đông Hán")).toBe(false);
    expect(isSensitiveTopic("Thời kỳ biến động của nhà Trần")).toBe(false);
    expect(isSensitiveTopic("2000 kỵ binh vượt sông năm 1288")).toBe(false);
    expect(isSensitiveTopic("Chiến dịch năm 1968 quân đội")).toBe(true);
    expect(isSensitiveTopic("Tranh chấp Biển Đông")).toBe(true);
    expect(isSensitiveTopic("Eo biển Đài Loan")).toBe(true);
  });
  it("kịch bản đã đủ dài (đã viết lượt kết) → coi là xong, không viết tiếp đè sau đoạn kết", () => {
    expect(historyScriptComplete(7000)).toBe(true);
    expect(historyScriptComplete(5000)).toBe(false);
  });
});

describe("trạng thái đề tài trên trang quản lý", () => {
  const ch = (o: Partial<{ status: string; content: string; factIssues: unknown }>) => ({ status: "outline", content: "", factIssues: null, ...o });
  it("ưu tiên: có video > chờ sửa > có kịch bản > đang viết > chưa viết", () => {
    expect(historyTopicStatus(ch({ status: "approved", content: "x" }), true)).toBe("co-video");
    expect(historyTopicStatus(ch({ content: "x", factIssues: [{}] }), false)).toBe("cho-sua");
    expect(historyTopicStatus(ch({ status: "draft", content: "x" }), false)).toBe("co-kich-ban");
    expect(historyTopicStatus(ch({ content: "x" }), false)).toBe("dang-viet");
    expect(historyTopicStatus(ch({}), false)).toBe("chua-viet");
    expect(HISTORY_STATUS_LABEL["cho-sua"]).toBe("Chờ sửa");
  });
});

describe("kiểm đề tài thêm tay", () => {
  it("thiếu tiêu đề / Wikipedia, hoặc nhạy cảm → báo lỗi; hợp lệ → null", () => {
    expect(validateHistoryTopic("Trận Gaugamela", "  ")).toMatch(/Wikipedia/);
    expect(validateHistoryTopic("", "Battle of Gaugamela")).toMatch(/tiêu đề/);
    expect(validateHistoryTopic("Hải chiến Hoàng Sa", "Battle of the Paracel Islands")).toMatch(/nhạy cảm/);
    expect(validateHistoryTopic("Trận Gaugamela", "Battle of Gaugamela")).toBeNull();
  });
});

describe("chặn duyệt kịch bản còn lỗi sự thật", () => {
  it("còn fact_issues → không cho duyệt; hết lỗi → cho", () => {
    expect(approvalBlockedReason({ factIssues: [{}] })).toMatch(/lỗi sự thật/);
    expect(approvalBlockedReason({ factIssues: null })).toBeNull();
  });
});

describe("luật lời kể không nêu tên nguồn tra cứu", () => {
  it("prompt viết cấm nêu Wikipedia/bách khoa/hồ sơ, chỉ cho nêu sử liệu gốc", () => {
    const p = historyChapterPrompt(series, chapter, "HỒ SƠ");
    expect(p.system).toMatch(/KHÔNG nêu tên.*Wikipedia/);
  });
});

