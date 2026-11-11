import { describe, expect, it } from "vitest";
import type { VideoMeta } from "@/db/schema";
import { backfillStatusText, isYoutubeQuotaMessage, nextBackfillState, pickShortBackfill, shortPublishAt, type BackfillCandidate } from "./short-backfill";

const now = new Date("2026-11-11T10:00:00Z");
const base: VideoMeta = { title: "", description: "", tags: [], shortTitle: "", shortDescription: "" };
const ep = (o: Partial<Omit<BackfillCandidate, "meta">> & { meta?: Partial<VideoMeta> } = {}): BackfillCandidate => ({
  id: 25, createdAt: new Date("2026-11-09T00:00:00Z"), youtubeVideoId: "abc", youtubeShortId: null,
  ...o,
  meta: { ...base, compilation: { seriesId: 4, from: 4, to: 6, videoIds: [1, 2, 3], episode: true, episodeNo: 1 }, ...o.meta },
});

describe("pickShortBackfill", () => {
  it("chọn tập đã lên YouTube, thiếu Short, trong 10 ngày", () => {
    expect(pickShortBackfill([ep()], now).map((v) => v.id)).toEqual([25]);
  });
  it("bỏ qua: đã có Short, chưa lên YouTube, quá 10 ngày, không phải tập, đã bỏ cuộc", () => {
    const rows = [
      ep({ id: 1, youtubeShortId: "s" }),
      ep({ id: 2, youtubeVideoId: null }),
      ep({ id: 3, createdAt: new Date("2026-10-30T00:00:00Z") }),
      { ...ep({ id: 4 }), meta: { ...base } },
      ep({ id: 5, meta: { shortBackfill: { attempts: 3, gaveUp: true } } }),
    ];
    expect(pickShortBackfill(rows, now)).toEqual([]);
  });
  it("cũ nhất trước, tối đa 2", () => {
    const rows = [ep({ id: 3, createdAt: new Date("2026-11-10T00:00:00Z") }), ep({ id: 1, createdAt: new Date("2026-11-05T00:00:00Z") }), ep({ id: 2, createdAt: new Date("2026-11-08T00:00:00Z") })];
    expect(pickShortBackfill(rows, now).map((v) => v.id)).toEqual([1, 2]);
  });
});

describe("nextBackfillState", () => {
  it("hết quota không tính lần thử", () => {
    expect(nextBackfillState({ attempts: 2 }, { kind: "quota" })).toEqual({ attempts: 2, lastReason: "quota" });
  });
  it("lỗi khác đếm lần, đủ 3 thì bỏ cuộc", () => {
    const one = nextBackfillState(undefined, { kind: "error", message: "x" });
    expect(one).toMatchObject({ attempts: 1, lastReason: "error" });
    expect(one.gaveUp).toBeUndefined();
    expect(nextBackfillState({ attempts: 2 }, { kind: "error", message: "x" })).toMatchObject({ attempts: 3, gaveUp: true });
  });
  it("thành công đánh dấu done", () => {
    expect(nextBackfillState({ attempts: 1 }, { kind: "ok" })).toEqual({ attempts: 1, done: true });
  });
});

describe("shortPublishAt", () => {
  it("tập còn ở tương lai: sau lịch tập 2 giờ", () => {
    expect(shortPublishAt(new Date("2026-11-12T08:00:00Z"), now)?.toISOString()).toBe("2026-11-12T10:00:00.000Z");
  });
  it("tập đã công khai hoặc không có lịch: đăng ngay", () => {
    expect(shortPublishAt(new Date("2026-11-10T08:00:00Z"), now)).toBeNull();
    expect(shortPublishAt(null, now)).toBeNull();
  });
});

describe("isYoutubeQuotaMessage / backfillStatusText", () => {
  it("nhận diện lỗi quota YouTube", () => {
    expect(isYoutubeQuotaMessage("YouTube từ chối upload: 403 quotaExceeded")).toBe(true);
    expect(isYoutubeQuotaMessage("ffmpeg lỗi")).toBe(false);
  });
  it("hiện đúng chữ theo trạng thái", () => {
    expect(backfillStatusText(ep())?.text).toBe("chờ làm Short");
    expect(backfillStatusText(ep({ meta: { shortBackfill: { attempts: 0, lastReason: "quota" } } }))?.text).toBe("chờ làm Short (hết quota)");
    expect(backfillStatusText(ep({ meta: { shortBackfill: { attempts: 3, gaveUp: true } } }))?.final).toBe(true);
    expect(backfillStatusText(ep({ youtubeShortId: "s" }))).toBeNull();
  });
});
