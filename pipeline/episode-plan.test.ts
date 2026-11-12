import { describe, expect, it } from "vitest";
import { pickBatch } from "./compile-plan";
import { buildEpisodeToc, chaptersToWrite, coldOpenSceneCount, fullBadge, HOOK_ZONE_SECONDS, isEpisodeOpener, planChapterScenes, shortSceneCount, ensureEpisodeLabel, episodeBacklog, fullLabel, imageCount, occupiesDailySlot, pickPublishSlot, tocText, vnDay } from "./episode-plan";

const row = (id: number, number: number, o: Partial<Parameters<typeof episodeBacklog>[0][number]> = {}) => ({
  id, number, status: "ready" as const, youtubeVideoId: null, publishAt: null, hasLong: true, meta: null, ...o,
});
const ep = (id: number, videoIds: number[], o: Partial<Parameters<typeof episodeBacklog>[0][number]> = {}) =>
  row(id, videoIds.length + 3, { meta: { title: "", description: "", tags: [], shortTitle: "", shortDescription: "", compilation: { seriesId: 4, from: 4, to: 6, videoIds, episode: true, episodeNo: 1 } }, ...o });

describe("vnDay", () => {
  it("sau 17:00 UTC đã sang ngày mới giờ VN", () => {
    expect(vnDay(new Date("2026-11-10T16:59:00Z"))).toBe("2026-11-10");
    expect(vnDay(new Date("2026-11-10T17:00:00Z"))).toBe("2026-11-11");
  });
  it("lượt 8h17 VN và 20h17 VN cùng ngày", () => {
    expect(vnDay(new Date("2026-11-10T01:17:00Z"))).toBe(vnDay(new Date("2026-11-10T13:17:00Z")));
  });
});

describe("chaptersToWrite", () => {
  const base = { chaptersPerDay: 3, writtenToday: 0, stockChapters: 0, episodeChapters: 3 };
  it("đầu ngày, kho trống: viết bù tới gấp đôi chỉ tiêu (6)", () => expect(chaptersToWrite(base)).toBe(6));
  it("đã viết gấp đôi hôm nay: 0 (marker, không đếm theo updatedAt)", () => expect(chaptersToWrite({ ...base, writtenToday: 6 })).toBe(0));
  it("đã viết 4: còn 2", () => expect(chaptersToWrite({ ...base, writtenToday: 4 })).toBe(2));
  it("kho 2 tập: vẫn viết tiếp (giữ 4 tập)", () => expect(chaptersToWrite({ ...base, stockChapters: 6 })).toBe(6));
  it("kho đã 4 tập: 0", () => expect(chaptersToWrite({ ...base, stockChapters: 12 })).toBe(0));
  it("kho 3 tập + 2 chương lẻ: chỉ viết 1", () => expect(chaptersToWrite({ ...base, stockChapters: 11 })).toBe(1));
  it("không âm khi kho vượt", () => expect(chaptersToWrite({ ...base, stockChapters: 15 })).toBe(0));
});

describe("imageCount", () => {
  it("chương nội bộ 40 phút: 1 ảnh/30 giây = 80 ảnh", () => expect(imageCount(2400, true)).toBe(80));
  it("chương nội bộ 20 phút: 40 ảnh", () => expect(imageCount(1200, true)).toBe(40));
  it("chương nội bộ 60 phút: chặn ở 80 ảnh", () => expect(imageCount(3600, true)).toBe(80));
  it("tối thiểu 6 ảnh", () => expect(imageCount(60, true)).toBe(6));
  it("video thường vẫn 1 ảnh/25 giây", () => expect(imageCount(500, false)).toBe(20));
});

describe("pickPublishSlot (15h VN = 08:00 UTC)", () => {
  const at = (iso: string) => pickPublishSlot([], 8, new Date(iso)).toISOString();
  it("dựng xong lúc 11h VN: đăng 15h hôm nay", () => expect(at("2026-11-10T04:00:00Z")).toBe("2026-11-10T08:00:00.000Z"));
  it("còn < 2 giờ: lùi sang mai", () => expect(at("2026-11-10T06:30:00Z")).toBe("2026-11-11T08:00:00.000Z"));
  it("ngày đã có tập: nhảy sang ngày kế (mỗi ngày 1 tập)", () => {
    const taken = [new Date("2026-11-10T08:00:00Z"), new Date("2026-11-11T08:00:00Z")];
    expect(pickPublishSlot(taken, 8, new Date("2026-11-10T01:00:00Z")).toISOString()).toBe("2026-11-12T08:00:00.000Z");
  });
});

describe("occupiesDailySlot", () => {
  const meta = (c?: object) => ({ title: "", description: "", tags: [], shortTitle: "", shortDescription: "", ...(c ? { compilation: { seriesId: 1, from: 1, to: 5, videoIds: [], ...c } } : {}) });
  it("chương thường và tập có; bản gộp 5 chương không", () => {
    expect(occupiesDailySlot(meta())).toBe(true);
    expect(occupiesDailySlot(null)).toBe(true);
    expect(occupiesDailySlot(meta({ episode: true }))).toBe(true);
    expect(occupiesDailySlot(meta({}))).toBe(false);
  });
});

describe("episodeBacklog + chọn lô 3 chương", () => {
  it("chương cũ đã đăng lẻ giữ nguyên: tập 1 bắt đầu từ chương 4", () => {
    const rows = [row(10, 1, { status: "published", youtubeVideoId: "a" }), row(11, 2, { status: "published", youtubeVideoId: "b" }), row(12, 3, { status: "published", youtubeVideoId: "c" }), row(13, 4), row(14, 5), row(15, 6), row(16, 7)];
    const { ready } = episodeBacklog(rows);
    const batch = pickBatch(ready.map((r) => ({ chapterId: r.id, number: r.number, title: "", videoId: r.id })), 3);
    expect(batch?.map((c) => c.number)).toEqual([4, 5, 6]);
  });
  it("chưa đủ 3 chương liền nhau thì null", () => {
    const { ready } = episodeBacklog([row(13, 4), row(14, 5)]);
    expect(pickBatch(ready.map((r) => ({ chapterId: r.id, number: r.number, title: "", videoId: r.id })), 3)).toBeNull();
  });
  it("chương đã nằm trong tập (không lỗi) thì không ghép lại; tập lỗi thì được ghép lại", () => {
    const base = [row(13, 4), row(14, 5), row(15, 6)];
    expect(episodeBacklog([...base, ep(20, [13, 14, 15])]).ready).toHaveLength(0);
    expect(episodeBacklog([...base, ep(20, [13, 14, 15], { status: "failed" })]).ready).toHaveLength(3);
  });
  it("chương chưa render xong là loose nhưng chưa ready", () => {
    const b = episodeBacklog([row(13, 4, { status: "rendering", hasLong: false }), row(14, 5)]);
    expect(b.loose).toHaveLength(2);
    expect(b.ready).toHaveLength(1);
  });
  it("tập đã qua giờ đăng không còn là upcoming; tập đang dựng / chờ đăng thì có", () => {
    const now = new Date("2026-11-10T09:00:00Z");
    const rows = [ep(20, [1, 2, 3], { publishAt: new Date("2026-11-10T08:00:00Z") }), ep(21, [4, 5, 6], { publishAt: new Date("2026-11-11T08:00:00Z") }), ep(22, [7, 8, 9], { status: "rendering" })];
    expect(episodeBacklog(rows, now).upcoming.map((r) => r.id)).toEqual([21, 22]);
  });
});

describe("buildEpisodeToc", () => {
  it("mốc chương cộng dồn, mục con cộng offset, bỏ mục con 00:00", () => {
    const toc = buildEpisodeToc([
      { number: 4, title: "A", seconds: 2400, sub: [{ start: 0, title: "Mở đầu" }, { start: 300, title: "Đột kích" }] },
      { number: 5, title: "B", seconds: 2400, sub: [{ start: 0, title: "Mở đầu" }, { start: 600, title: "Phản đòn" }] },
    ]);
    expect(tocText(toc).split("\n")).toEqual(["00:00 Chương 4: A", "05:00 · Đột kích", "40:00 Chương 5: B", "50:00 · Phản đòn"]);
  });
  it("qua 1 giờ dùng H:MM:SS", () => {
    const toc = buildEpisodeToc([{ number: 1, title: "A", seconds: 3700, sub: [] }, { number: 2, title: "B", seconds: 10, sub: [] }]);
    expect(tocText(toc).split("\n")[1]).toBe("1:01:40 Chương 2: B");
  });
  it("có đoạn mở đầu: 00:00 là mở đầu, mọi chương và mục con dời theo", () => {
    const toc = buildEpisodeToc(
      [
        { number: 4, title: "A", seconds: 2400, sub: [{ start: 0, title: "Mở đầu" }, { start: 300, title: "Đột kích" }] },
        { number: 5, title: "B", seconds: 2400, sub: [] },
      ],
      { seconds: 32, title: "Mở đầu" },
    );
    expect(tocText(toc).split("\n")).toEqual(["00:00 Mở đầu", "00:32 Chương 4: A", "05:32 · Đột kích", "40:32 Chương 5: B"]);
  });
});

describe("coldOpenSceneCount", () => {
  // Intro dồn dập: ~3,5 giây 1 ảnh thay vì ~6 — intro 30–45 giây có 9–13 ảnh thay vì 5–8.
  it("~3,5 giây 1 ảnh, kẹp 8–14", () => {
    expect(coldOpenSceneCount(10)).toBe(8);
    expect(coldOpenSceneCount(32)).toBe(9);
    expect(coldOpenSceneCount(45)).toBe(13);
    expect(coldOpenSceneCount(90)).toBe(14);
  });
  it("cắt nhanh hơn Short một chút nhưng cùng cỡ — đều là đoạn giữ chân người xem", () => {
    expect(coldOpenSceneCount(35)).toBeGreaterThanOrEqual(shortSceneCount(35) - 1);
  });
});

describe("shortSceneCount", () => {
  it("~3,5 giây 1 ảnh, kẹp 5–30", () => {
    expect(shortSceneCount(10)).toBe(5);
    expect(shortSceneCount(70)).toBe(20);
    expect(shortSceneCount(90)).toBe(26);
    expect(shortSceneCount(600)).toBe(30);
  });
});

describe("planChapterScenes", () => {
  it("120 giây đầu 20 ảnh × 6 giây có zoom, sau đó 1 ảnh/30 giây không zoom", () => {
    const plan = planChapterScenes(1920);
    const head = plan.filter((x) => x.zoom);
    expect(head).toHaveLength(20);
    expect(head[1].start).toBeCloseTo(6);
    expect(head.at(-1)!.end).toBeCloseTo(120);
    const rest = plan.filter((x) => !x.zoom);
    expect(rest).toHaveLength(60);
    expect(rest[0].start).toBeCloseTo(120);
    expect(rest[0].end - rest[0].start).toBeCloseTo(30);
  });
  it("phủ kín [0, seconds], liền nhau, không hở", () => {
    for (const total of [45, 120, 130, 1234.5, 3600, 9000]) {
      const plan = planChapterScenes(total);
      expect(plan[0].start).toBe(0);
      expect(plan.at(-1)!.end).toBeCloseTo(total);
      plan.slice(1).forEach((sc, i) => expect(sc.start).toBeCloseTo(plan[i].end));
    }
  });
  it("tổng không quá 80 ảnh phần sau + 20 ảnh đầu; chương ngắn thì cả chương nhịp nhanh", () => {
    expect(planChapterScenes(20000).filter((x) => !x.zoom)).toHaveLength(80);
    expect(planChapterScenes(45).every((x) => x.zoom)).toBe(true);
    expect(planChapterScenes(45)).toHaveLength(8);
  });
});

describe("fullBadge", () => {
  it("giờ + phút làm tròn 5 phút", () => {
    expect(fullBadge(5400)).toBe("FULL 1H30");
    expect(fullBadge(5500)).toBe("FULL 1H30");
    expect(fullBadge(7200)).toBe("FULL 2H");
    expect(fullBadge(3500)).toBe("FULL 1H");
    expect(fullBadge(7080)).toBe("FULL 2H");
    expect(fullBadge(4500)).toBe("FULL 1H15");
  });
});

describe("tiêu đề tập", () => {
  it("fullLabel làm tròn giờ", () => {
    expect(fullLabel(7300)).toBe("FULL 2H");
    expect(fullLabel(1000)).toBe("FULL 1H");
  });
  it("giữ tiêu đề đã có nhãn", () => expect(ensureEpisodeLabel("Hắn nuốt thần ma | FULL 2H", { episodeNo: 1, from: 4, to: 6 })).toBe("Hắn nuốt thần ma | FULL 2H"));
  it("thiếu nhãn thì nối Tập N (Chương X–Y)", () => expect(ensureEpisodeLabel("Hắn nuốt thần ma", { episodeNo: 2, from: 7, to: 9 })).toBe("Hắn nuốt thần ma | Tập 2 (Chương 7–9)"));
  it("tiêu đề quá dài vẫn ≤ 100 ký tự và còn nhãn", () => {
    const out = ensureEpisodeLabel("x".repeat(150), { episodeNo: 2, from: 7, to: 9 });
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("Tập 2 (Chương 7–9)")).toBe(true);
  });
});

describe("chương mở đầu tập: 15 phút đầu nhịp nhanh", () => {
  it("isEpisodeOpener theo nhóm k chương sau tập gần nhất", () => {
    expect([16, 17, 18, 19, 20, 21, 22].map((n) => isEpisodeOpener(n, 15, 3))).toEqual([true, false, false, true, false, false, true]);
    expect(isEpisodeOpener(1, 0, 3)).toBe(true);
    expect(isEpisodeOpener(15, 15, 3)).toBe(false);
    expect(isEpisodeOpener(16, 15, 0)).toBe(false);
  });
  it("chương mở tập 35 phút: tới phút 15 đều zoom, ~10 giây/ảnh; sau đó 30 giây/ảnh", () => {
    const plan = planChapterScenes(2100, true);
    const zoom = plan.filter((x) => x.zoom);
    expect(zoom[zoom.length - 1].end).toBeCloseTo(HOOK_ZONE_SECONDS);
    expect(zoom.length).toBe(20 + 78);
    expect(plan.filter((x) => !x.zoom)).toHaveLength(40);
    expect(plan[plan.length - 1].end).toBe(2100);
  });
  it("chương thường không đổi", () => {
    expect(planChapterScenes(2100, false)).toEqual(planChapterScenes(2100));
    expect(planChapterScenes(2100).filter((x) => x.zoom)).toHaveLength(20);
  });
});
