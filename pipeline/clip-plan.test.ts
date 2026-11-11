import { describe, expect, it } from "vitest";
import { buildClipDescription, canUploadClip, clipHashtags, clipsToMake, clipTags, ensureShortsTag, fullEpisodeUrl, pickClipSlot, pickClipSources, pickClipTitle, type ClipSource } from "./clip-plan";
import { occupiesDailySlot } from "./episode-plan";

const at = (iso: string) => new Date(iso);
const src = (chapterId: number, number: number): ClipSource => ({ chapterId, number, episodeVideoId: 1, episodeYoutubeId: null, episodePublishAt: null });

describe("pickClipSlot", () => {
  it("lấy 12h VN (05 UTC) trước, rồi 21h VN (14 UTC)", () => {
    const now = at("2026-11-11T01:17:00Z");
    expect(pickClipSlot([], now).toISOString()).toBe("2026-11-11T05:00:00.000Z");
    expect(pickClipSlot([at("2026-11-11T05:00:00Z")], now).toISOString()).toBe("2026-11-11T14:00:00.000Z");
  });
  it("hai khung của ngày đã đầy (trần 2 Short/ngày) thì sang ngày mai, không dùng 18h", () => {
    const taken = [at("2026-11-11T05:00:00Z"), at("2026-11-11T14:00:00Z")];
    expect(pickClipSlot(taken, at("2026-11-11T01:00:00Z")).toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });
  it("khung đã qua (hoặc còn dưới 30 phút) bị bỏ; 18h VN chỉ dùng khi 12h/21h không dùng được", () => {
    expect(pickClipSlot([at("2026-11-11T14:00:00Z")], at("2026-11-11T06:00:00Z")).toISOString()).toBe("2026-11-11T11:00:00.000Z");
    expect(pickClipSlot([], at("2026-11-11T13:45:00Z")).toISOString()).toBe("2026-11-12T05:00:00.000Z");
  });
  it("không bao giờ rơi vào 15h VN (08 UTC) của tập", () => {
    for (let h = 0; h < 24; h++) expect(pickClipSlot([], at(`2026-11-11T${String(h).padStart(2, "0")}:00:00Z`)).getUTCHours()).not.toBe(8);
  });
});

describe("clipsToMake", () => {
  it("giới hạn theo lượt, ngày và unit", () => {
    expect(clipsToMake({ createdToday: 0, usedUnits: 0 })).toBe(2);
    expect(clipsToMake({ createdToday: 1, usedUnits: 0 })).toBe(1);
    expect(clipsToMake({ createdToday: 2, usedUnits: 0 })).toBe(0);
    expect(clipsToMake({ createdToday: 0, usedUnits: 6500 })).toBe(1);
    expect(clipsToMake({ createdToday: 0, usedUnits: 8000 })).toBe(0);
  });
  it("canUploadClip chừa phần dự phòng cho tập", () => {
    expect(canUploadClip(3000)).toBe(true);
    expect(canUploadClip(7000)).toBe(false);
  });
});

describe("pickClipSources", () => {
  it("bỏ chương đã dùng, chương mới nhất trước, mỗi chương một lần", () => {
    const r = pickClipSources([src(1, 1), src(2, 2), src(3, 3), src(3, 3)], [2], 5);
    expect(r.map((x) => x.chapterId)).toEqual([3, 1]);
  });
  it("tôn trọng giới hạn", () => {
    expect(pickClipSources([src(1, 1), src(2, 2), src(3, 3)], [], 2).map((x) => x.number)).toEqual([3, 2]);
  });
});

describe("tiêu đề Short", () => {
  it("luôn có đúng một #shorts và ≤ 100 ký tự", () => {
    expect(ensureShortsTag("Hắn bị phản bội #Shorts")).toBe("Hắn bị phản bội #shorts");
    const long = ensureShortsTag("x".repeat(200));
    expect(long.length).toBeLessThanOrEqual(100);
    expect(long.endsWith(" #shorts")).toBe(true);
  });
  it("lấy tiêu đề điểm cao nhất có từ khóa, gắn #shorts", () => {
    const r = pickClipTitle(
      [
        { title: "Truyện tu tiên: hắn đột phá giữa tử địa", score: 88 },
        { title: "Hắn đột phá", score: 90 },
      ],
      ["truyện tu tiên"],
    );
    expect(r).toEqual({ title: "Truyện tu tiên: hắn đột phá giữa tử địa #shorts", score: 88 });
  });
});

describe("mô tả và tag", () => {
  it("link tập khi tập đã công khai lúc Short lên, không thì link danh sách phát", () => {
    const base = { episodeYoutubeId: "abc", clipPublishAt: at("2026-11-12T05:00:00Z"), playlistUrl: "https://pl" };
    expect(fullEpisodeUrl({ ...base, episodePublishAt: at("2026-11-11T08:00:00Z") })).toBe("https://youtu.be/abc");
    expect(fullEpisodeUrl({ ...base, episodePublishAt: at("2026-11-12T08:00:00Z") })).toBe("https://pl");
    expect(fullEpisodeUrl({ ...base, episodeYoutubeId: null, episodePublishAt: null })).toBe("https://pl");
  });
  it("hashtag đủ 5 và có tên truyện", () => {
    expect(clipHashtags("Ma Tôn Trọng Sinh")).toEqual(["#shorts", "#truyentutien", "#truyenaudio", "#tienhiep", "#matontrongsinh"]);
  });
  it("mô tả có dòng nghe FULL, link playlist, hashtag", () => {
    const d = buildClipDescription({ body: "Hắn đối mặt tử địa. Truyện tu tiên audio.", fullUrl: "https://youtu.be/abc", playlistUrl: "https://pl", seriesTitle: "Ma Tôn" });
    expect(d).toContain("▶ Nghe FULL tập: https://youtu.be/abc");
    expect(d).toContain("https://pl");
    expect(d).toContain("#shorts #truyentutien #truyenaudio #tienhiep #maton");
  });
  it("tag: từ khóa VN trước, bỏ trùng", () => {
    expect(clipTags(["truyện audio", "tu tiên"], "Ma Tôn").slice(0, 3)).toEqual(["truyện audio", "tu tiên", "truyện tu tiên"]);
    expect(clipTags(["Truyện Audio"], "X").filter((t) => t.toLowerCase() === "truyện audio")).toHaveLength(1);
  });
});

describe("lịch ngày của tập", () => {
  it("Short cắt cảnh không chiếm khung 15h của tập", () => {
    expect(occupiesDailySlot({ shortClip: { sourceChapterId: 1, scoreTitle: 90 } } as never)).toBe(false);
    expect(occupiesDailySlot(null)).toBe(true);
  });
});
