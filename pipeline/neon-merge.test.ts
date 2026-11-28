import { describe, expect, it } from "vitest";
import type { VideoMeta } from "@/db/schema";
import { ARCHIVE_NUMBER_OFFSET, importedVideoStatus, PLAYLISTS_KEY, planChapter, planSeries, remapSetting, remapVideoMeta, type IdMaps } from "./neon-merge";

const life = { genre: "Chuyện đời", channel: "chuyen-doi" };

describe("planSeries — bộ cũ gộp vào bộ đang chạy khi trùng thể loại + kênh", () => {
  it("trùng → id bộ đang chạy; bộ kênh cũ không còn → null (thêm mới)", () => {
    const plan = planSeries(
      [{ id: 7, title: "Chuyện Đời (cũ)", ...life }, { id: 4, title: "Thôn Phệ", genre: "Tiên hiệp", channel: "main" }],
      [{ id: 1, title: "Chuyện Đời Lắng Đọng", ...life }],
    );
    expect(plan.get(7)).toBe(1);
    expect(plan.get(4)).toBeNull();
  });
});

describe("planChapter", () => {
  const current = [{ id: 10001, seriesId: 1, number: 3, title: "Mẹ Ký Giấy Vay Nặng Lãi" }];

  it("trùng tên (không phân biệt hoa thường, khoảng trắng) trong bộ đích → dùng lại chương đang có", () => {
    expect(planChapter({ id: 5, seriesId: 7, number: 3, title: " mẹ ký giấy vay nặng lãi " }, 1, true, current)).toEqual({ kind: "reuse", targetId: 10001 });
  });

  it("bộ được gộp → số âm (không đụng unique series+number, vẫn nằm trong danh sách truyện đã có)", () => {
    expect(planChapter({ id: 6, seriesId: 7, number: 3, title: "Truyện khác" }, 1, true, current)).toEqual({ kind: "insert", seriesId: 1, number: ARCHIVE_NUMBER_OFFSET + 3 });
  });

  it("bộ thêm mới → giữ số cũ", () => {
    expect(planChapter({ id: 8, seriesId: 4, number: 12, title: "Chương 12" }, 10002, false, current)).toEqual({ kind: "insert", seriesId: 10002, number: 12 });
  });
});

describe("remapVideoMeta", () => {
  const maps: IdMaps = { series: new Map([[4, 10002]]), chapters: new Map([[50, 10050]]), videos: new Map([[20, 10020], [21, 10021]]) };

  it("bản gộp: seriesId + videoIds sang id mới", () => {
    const meta = { title: "t", compilation: { seriesId: 4, from: 1, to: 2, videoIds: [20, 21] } } as VideoMeta;
    expect(remapVideoMeta(meta, maps)?.compilation).toEqual({ seriesId: 10002, from: 1, to: 2, videoIds: [10020, 10021] });
  });

  it("Short cắt cảnh: chương nguồn + tập chứa sang id mới; không có episodeVideoId thì không thêm", () => {
    const withEp = { title: "t", shortClip: { sourceChapterId: 50, scoreTitle: null, episodeVideoId: 21 } } as VideoMeta;
    expect(remapVideoMeta(withEp, maps)?.shortClip).toEqual({ sourceChapterId: 10050, scoreTitle: null, episodeVideoId: 10021 });
    const noEp = { title: "t", shortClip: { sourceChapterId: 50, scoreTitle: 7 } } as VideoMeta;
    expect(remapVideoMeta(noEp, maps)?.shortClip).toEqual({ sourceChapterId: 10050, scoreTitle: 7 });
  });

  it("meta null giữ null; meta không có id thì giữ nguyên", () => {
    expect(remapVideoMeta(null, maps)).toBeNull();
    expect(remapVideoMeta({ title: "x" } as VideoMeta, maps)).toEqual({ title: "x" });
  });
});

describe("remapSetting — cài đặt mới trên Supabase luôn thắng", () => {
  const seriesMap = new Map([[4, 10002], [7, 1]]);

  it("hero_ref_<id> đổi theo id bộ mới, không ghi đè; bộ không có trong bản đồ → bỏ", () => {
    expect(remapSetting("hero_ref_4", { jpg: "x" }, seriesMap, null)).toEqual({ key: "hero_ref_10002", value: { jpg: "x" }, overwrite: false });
    expect(remapSetting("hero_ref_99", { jpg: "x" }, seriesMap, null)).toBeNull();
  });

  it("yt_playlists: đổi khoá theo id mới rồi gộp, giá trị hiện có thắng khi trùng", () => {
    const r = remapSetting(PLAYLISTS_KEY, { "4": "PL_old4", "7": "PL_old7" }, seriesMap, { "1": "PL_new1" });
    expect(r).toEqual({ key: PLAYLISTS_KEY, value: { "10002": "PL_old4", "1": "PL_new1" }, overwrite: true });
  });

  it("khoá khác: chỉ thêm khi chưa có (overwrite false)", () => {
    expect(remapSetting("youtube:chuyen-doi", { token: "old" }, seriesMap, { token: "new" })).toEqual({ key: "youtube:chuyen-doi", value: { token: "old" }, overwrite: false });
  });
});

describe("importedVideoStatus — video cũ dở dang không tự render lại", () => {
  it("queued/rendering → failed kèm lý do; trạng thái xong giữ nguyên", () => {
    expect(importedVideoStatus("queued").status).toBe("failed");
    expect(importedVideoStatus("rendering").error).toMatch(/Neon/);
    expect(importedVideoStatus("published")).toEqual({ status: "published", error: null });
    expect(importedVideoStatus("ready")).toEqual({ status: "ready", error: null });
  });
});
