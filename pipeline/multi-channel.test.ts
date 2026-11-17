import { describe, expect, it } from "vitest";
import type { Chapter, Series } from "@/db/schema";
import { channelProfile, titleMatches } from "@/lib/channel-profile";
import { chapterPrompt, continuePrompt, outlinePrompt } from "@/lib/story/prompts";
import { LIFE_GENRE, LIFE_PILOT, pilotOutline } from "@/lib/story/life";
import { isChannelKey, MAIN_CHANNEL, ytKey } from "@/lib/youtube";
import { ctaComment } from "./comment";
import { composeDescription, hashtagsFor } from "./description";
import { pickPublishSlot, pickSpacedSlot } from "./episode-plan";
import { genreSeeds } from "./vidiq";

const series = (o: Partial<Series> = {}): Series => ({
  id: 9, title: "Chuyện Đời Lắng Đọng", genre: LIFE_GENRE, premise: "p", bible: "b", style: "", targetWords: 1700,
  autopilot: true, autoApprove: true, chaptersPerDay: 1, episodeChapters: 0, ttsVoice: "Charon", makeShort: true,
  autoPublish: true, channel: "chuyen-doi", voiceStyle: "v", createdAt: new Date(), ...o,
});
const chapter = (o: Partial<Chapter> = {}): Chapter => ({
  id: 1, seriesId: 9, number: 1, title: LIFE_PILOT[0].title, outline: pilotOutline(LIFE_PILOT[0]), content: "", summary: "",
  status: "outline", createdAt: new Date(), updatedAt: new Date(), ...o,
});

describe("khoá kênh", () => {
  it("kênh gốc giữ key cũ, kênh phụ có hậu tố", () => {
    expect(ytKey(MAIN_CHANNEL)).toBe("youtube");
    expect(ytKey("chuyen-doi")).toBe("youtube:chuyen-doi");
  });
  it("kết nối kênh chuyện đời phải đúng tên kênh (không nhận kênh cá nhân cùng account)", () => {
    expect(titleMatches("chuyen-doi", "Chuyện Đời Lắng Đọng")).toBe(true);
    expect(titleMatches("chuyen-doi", "chuyện đời  lắng đọng")).toBe(true);
    expect(titleMatches("chuyen-doi", "Trọng Bảo Phạm")).toBe(false);
    expect(titleMatches("chuyen-doi", null)).toBe(false);
    expect(titleMatches("main", "Ma Tôn Truyện")).toBe(true);
  });
  it("chặn khoá lạ (dùng trong URL/state OAuth)", () => {
    expect(isChannelKey("chuyen-doi")).toBe(true);
    expect(isChannelKey("Chuyen Doi")).toBe(false);
    expect(isChannelKey("a.b")).toBe(false);
    expect(isChannelKey("")).toBe(false);
  });
});

describe("pickSpacedSlot", () => {
  const now = new Date("2026-11-17T00:00:00Z");
  it("chưa có video nào → như pickPublishSlot", () => {
    expect(pickSpacedSlot([], 8, 3, now)).toEqual(pickPublishSlot([], 8, now));
  });
  it("cách video gần nhất đúng 3 ngày", () => {
    expect(pickSpacedSlot([new Date("2026-11-18T08:00:00Z")], 8, 3, now).toISOString()).toBe("2026-11-21T08:00:00.000Z");
  });
  it("video cũ đã qua lâu → khung sớm nhất từ hôm nay", () => {
    expect(pickSpacedSlot([new Date("2026-11-01T08:00:00Z")], 8, 3, now).toISOString()).toBe("2026-11-17T08:00:00.000Z");
  });
  it("gap 1 = mỗi ngày như cũ", () => {
    const taken = [new Date("2026-11-17T08:00:00Z")];
    expect(pickSpacedSlot(taken, 8, 1, now)).toEqual(pickPublishSlot(taken, 8, now));
  });
  it("hồ sơ kênh: chuyện đời 3 ngày, kênh gốc mỗi ngày", () => {
    expect(channelProfile("chuyen-doi").publishEveryDays).toBe(3);
    expect(channelProfile("main").publishEveryDays).toBe(1);
    expect(channelProfile("la").publishEveryDays).toBe(1);
  });
});

describe("prompt chuyện đời", () => {
  it("chương = truyện độc lập, không luật tiên hiệp, không cliffhanger", () => {
    const p = chapterPrompt(series(), [], chapter());
    expect(p.prompt).toContain(LIFE_PILOT[0].title);
    expect(p.system).toContain("HƯ CẤU");
    expect(p.system).not.toContain("bàn tay vàng");
    expect(p.system).toContain("KHÔNG cliffhanger");
  });
  it("viết tiếp phải kết trọn vẹn", () => {
    const base = chapterPrompt(series(), [], chapter());
    const p = continuePrompt(base, "Mẹ ơi.", 1700, true);
    expect(p.prompt).toContain("kết trọn vẹn");
    expect(p.prompt).not.toContain("cliffhanger.");
  });
  it("hết truyện nạp sẵn: nghĩ truyện mới không trùng", () => {
    const p = outlinePrompt(series(), [chapter()], 5);
    expect(p.prompt).toContain("KHÔNG lặp lại");
    expect(p.prompt).toContain(LIFE_PILOT[0].title);
  });
  it("bộ tiên hiệp vẫn dùng prompt cũ", () => {
    const p = chapterPrompt(series({ genre: "Tiên hiệp", channel: "main" }), [], chapter());
    expect(p.system).toContain("bàn tay vàng");
  });
  it("10 truyện thử nghiệm, truyện 1 là người mẹ không còn nơi để về", () => {
    expect(LIFE_PILOT).toHaveLength(10);
    expect(LIFE_PILOT[0].title).toContain("Không Còn Nơi Để Về");
  });
});

describe("chữ theo kênh", () => {
  it("hashtag + từ khóa vidIQ theo ngách", () => {
    expect(hashtagsFor([], "chuyen-doi")).toContain("#ChuyenDoi");
    expect(hashtagsFor([])).toContain("#TruyenTuTien");
    expect(genreSeeds(LIFE_GENRE)).toContain("chuyện đời");
  });
  it("mô tả dùng link kênh được truyền vào", () => {
    const d = composeDescription("Thân bài", [], [], [], "", "https://www.youtube.com/channel/UCnew");
    expect(d).toContain("https://www.youtube.com/channel/UCnew?sub_confirmation=1");
    expect(d).not.toContain("mới mỗi ngày");
  });
  it("bình luận kênh chuyện đời nói theo 'câu chuyện', nhịp đăng của kênh", () => {
    const c = ctaComment({ seriesTitle: "X", playlistUrl: null, channelUrl: "https://y", publishHour: "15h", cadence: "chuyện mới mỗi tuần" });
    expect(c).toContain("câu chuyện");
    expect(c).toContain("chuyện mới mỗi tuần");
    expect(c).not.toContain("tập mới mỗi ngày");
  });
});
