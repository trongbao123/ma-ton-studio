import { describe, expect, it } from "vitest";
import { buildFlow, CARD_ORDER, formatSlot, formatTime, quotaCard, type CardId, type FlowData } from "./model";

type VideoOverrides = Partial<FlowData["video"]>;

function data(v: VideoOverrides = {}, extra: Partial<Omit<FlowData, "video">> = {}): FlowData {
  return {
    video: {
      id: 31,
      status: "ready",
      error: null,
      runUrl: null,
      publishAt: null,
      durationSec: 1120,
      youtubeUrl: null,
      meta: { title: "Huyết Ma Điện", description: `mô tả\n\nNhạc nền: "Dark Fog" – Kevin MacLeod (incompetech.com)`, tags: ["ma tôn"], shortTitle: "Short", shortDescription: "mô tả short" },
      files: { "long.mp4": "/api/videos/31/long.mp4", "short.mp4": "/api/videos/31/short.mp4", "thumbnail.jpg": "/api/videos/31/thumbnail.jpg" },
      createdAt: "2026-11-09T07:00:00.000Z",
      updatedAt: "2026-11-09T07:30:00.000Z",
      progress: { steps: {} },
      uploadStatus: "none",
      uploadError: null,
      youtubeVideoId: null,
      youtubeShortId: null,
      ...v,
    },
    chapter: { id: 7, number: 12, title: "Huyết Ma Điện", words: 5840, content: "Gió tanh…", outline: "dàn ý", approvedAt: "2026-11-09T07:00:00.000Z" },
    series: { id: 1, title: "Ma Tôn Truyện", bibleExcerpt: "bible", voiceStyle: "giọng nam trầm", ttsVoice: "Algenib", makeShort: true, autoPublish: true },
    prevSummary: null,
    youtube: { connected: false, channel: null },
    trends: null,
    compiledInto: null,
    ai: { image: { model: "gpt-image (gói)", source: "tracked" }, text: { story: [{ provider: "claude-cli", model: "haiku" }], meta: [], scenes: [] }, available: ["claude-cli"] },
    ...extra,
  };
}

const RENDER: CardId[] = ["seo", "tts", "images", "video"];
const OUTPUT: CardId[] = ["thumbnail", "long", "short"];
const states = (d: FlowData) => Object.fromEntries(CARD_ORDER.map((k) => [k, buildFlow(d).cards[k].state]));

describe("buildFlow", () => {
  it("10 thẻ của cây dọc đúng thứ tự", () => {
    expect(CARD_ORDER).toEqual(["trends", "chapter", "seo", "tts", "images", "thumbnail", "video", "long", "short", "youtube"]);
    expect(Object.keys(buildFlow(data()).cards)).toEqual(CARD_ORDER);
  });

  it("ready đủ file: nhóm render done, youtube chờ đăng theo lịch, không có việc kẹt", () => {
    const { cards, issues } = buildFlow(data({ status: "ready", publishAt: "2026-11-12T12:00:00.000Z" }, { youtube: { connected: true, channel: "Kênh" } }));
    expect(RENDER.map((k) => cards[k].state)).toEqual(["done", "done", "done", "done"]);
    expect(cards.youtube.state).toBe("wait");
    expect(cards.youtube.subtitle).toContain("19:00");
    expect(cards.youtube.metrics).toEqual(["Lịch 19:00 · T5 12/11"]);
    expect(cards.chapter).toMatchObject({ state: "done", subtitle: "Chương 12" });
    expect(issues.map((i) => i.text).filter((t) => !t.startsWith("Điểm SEO"))).toEqual([]);
  });

  it("ready không có lịch thì chờ đăng tay", () => {
    expect(buildFlow(data({ status: "ready", publishAt: null })).cards.youtube.subtitle).toBe("chờ đăng tay");
  });

  it("thiếu Short: video vẫn done, có cảnh báo và việc cần làm", () => {
    const r = buildFlow(data({ status: "ready", files: { "long.mp4": "/x" } }));
    expect(r.cards.video).toMatchObject({ state: "done" });
    expect(r.cards.short).toMatchObject({ state: "skip", subtitle: "không có Short", warning: "Không có Short" });
    expect(r.cards.long.state).toBe("done");
    expect(r.cards.video.metrics[0]).toBe("chỉ video dài");
    expect(r.cards.images.metrics).toEqual([]);
    expect(r.issues).toContainEqual({ tone: "warn", text: "Không có Short", card: "short" });
  });

  it("failed với meta null không crash, youtube skip, issue đỏ", () => {
    const r = buildFlow(data({ status: "failed", meta: null, error: "ffmpeg chết", files: {} }));
    expect(RENDER.map((k) => r.cards[k].state)).toEqual(["error", "error", "error", "error"]);
    expect(r.cards.youtube).toMatchObject({ state: "skip", subtitle: "không đăng vì render lỗi" });
    expect(r.cards.seo.metrics).toEqual([]);
    expect(r.issues[0]).toEqual({ tone: "error", text: "Render lỗi: ffmpeg chết", card: "video" });
  });

  it("queued vì hết quota ảnh: thẻ Ảnh cảnh 'chờ quota', các thẻ khác chờ, có issue", () => {
    const r = buildFlow(data({ status: "queued", error: "Hết quota ảnh Cloudflare hôm nay — chờ reset 7h sáng.", meta: null }));
    expect(r.cards.images.state).toBe("quota");
    expect(r.cards.tts.state).toBe("wait");
    expect(r.issues).toEqual([{ tone: "warn", text: "Chờ quota ảnh: Hết quota ảnh Cloudflare hôm nay — chờ reset 7h sáng.", card: "images" }]);
  });

  it("quotaCard: lỗi quota của AI chữ → thẻ SEO; lỗi khác hoặc không queued → null", () => {
    expect(quotaCard({ status: "queued", error: "Hết quota Gemini hôm nay" })).toBe("seo");
    expect(quotaCard({ status: "queued", error: "Chờ máy" })).toBeNull();
    expect(quotaCard({ status: "failed", error: "Hết quota ảnh" })).toBeNull();
  });

  it("queued không lỗi thì không có issue", () => {
    expect(buildFlow(data({ status: "queued", meta: null })).issues).toEqual([]);
  });

  it("rendering: nhóm render run, chương done, youtube chờ", () => {
    const { cards } = buildFlow(data({ status: "rendering" }));
    expect(cards.chapter.state).toBe("done");
    expect(cards.tts).toMatchObject({ state: "run", subtitle: "đang render" });
    expect(cards.youtube.state).toBe("wait");
  });

  it("published: youtube done", () => {
    expect(buildFlow(data({ status: "published" })).cards.youtube).toMatchObject({ state: "done", subtitle: "đã đăng" });
  });

  it("Xu hướng: chưa quét → idle; đã quét hiện thời điểm + chủ đề #1; quá hạn có cảnh báo", () => {
    expect(buildFlow(data()).cards.trends).toMatchObject({ state: "idle", subtitle: "chưa quét", ai: { label: "vidIQ + GPT" } });
    const t = { scannedAt: "2026-11-09T07:32:00.000Z", fresh: true, summary: "", hotTopics: [{ topic: "Trọng sinh tu tiên", why: "x" }], titlePatterns: [], risingKeywords: [] };
    const done = buildFlow(data({}, { trends: t })).cards.trends;
    expect(done).toMatchObject({ state: "done", metrics: ["Quét 14:32 09/11", "Hot #1: Trọng sinh tu tiên"] });
    expect(done.warning).toBeUndefined();
    expect(buildFlow(data({}, { trends: { ...t, fresh: false } })).cards.trends.warning).toContain("7 ngày");
  });

  it("Viết chương: model theo routing story, số từ, số chương, chip bible + tóm tắt", () => {
    const r = buildFlow(data({}, { prevSummary: "tóm tắt" })).cards.chapter;
    expect(r.ai).toEqual({ label: "haiku", brand: "claude" });
    expect(r.metrics).toEqual(["5.840 từ", "Chương 12"]);
    expect(r.chips).toEqual(["Story bible", "Tóm tắt chương trước"]);
    expect(buildFlow(data()).cards.chapter.chips).toEqual(["Story bible"]);
  });

  it("SEO & Thumbnail: điểm SEO app, điểm tiêu đề vidIQ, top 3 từ khóa, ảnh thumbnail, model meta thật", () => {
    const meta = { title: "Huyết Ma Điện", description: "mô tả", tags: ["ma tôn"], shortTitle: "Short", shortDescription: "s", seo: { titleScore: 72, keywords: ["a", "b", "c", "d"] } };
    const progress = { steps: { agent: { state: "done" as const, model: "gpt-6-luna", log: [] } } };
    const c = buildFlow(data({ meta, progress })).cards.seo;
    expect(c.metrics[0]).toMatch(/^SEO \d+\/100$/);
    expect(c.metrics[1]).toBe("Tiêu đề vidIQ 72");
    expect(c.chips).toEqual(["a", "b", "c"]);
    expect(c.thumb).toBeUndefined();
    expect(c.ai).toEqual({ label: "gpt-6-luna", brand: "openai" });
  });

  it("Thumbnail / Video dài / Short: trạng thái và chỉ số từ file + tiến độ dựng thật", () => {
    const ready = buildFlow(data({ status: "ready" })).cards;
    expect(OUTPUT.map((k) => ready[k].state)).toEqual(["done", "done", "done"]);
    expect(ready.thumbnail).toMatchObject({ thumb: "/api/videos/31/thumbnail.jpg", metrics: ["thumbnail.jpg"] });
    expect(ready.long.metrics).toEqual(["Thời lượng 18:40"]);

    const progress = { steps: { video: { state: "run" as const, long: { done: 12, total: 30 }, short: { done: 1, total: 5 }, log: [] } } };
    const run = buildFlow(data({ status: "rendering", files: {}, progress })).cards;
    expect(run.long).toMatchObject({ state: "run", metrics: ["12/30 cảnh"], progress: 12 / 30 });
    expect(run.short).toMatchObject({ state: "run", progress: 1 / 5 });
    expect(run.thumbnail.state).toBe("wait"); // bước Ảnh cảnh chưa tới lượt

    const failed = buildFlow(data({ status: "failed", files: {}, meta: null })).cards;
    expect(OUTPUT.map((k) => failed[k].state)).toEqual(["error", "error", "error"]);
  });

  it("Short: bộ truyện tắt Short thì bỏ qua, không cảnh báo; thiếu thumbnail sau khi xong thì bỏ qua", () => {
    const off = buildFlow(data({ status: "ready", files: { "long.mp4": "/x", "thumbnail.jpg": "/t" } }, { series: { ...data().series, makeShort: false } }));
    expect(off.cards.short).toMatchObject({ state: "skip", subtitle: "bộ truyện tắt Short" });
    expect(off.cards.short.warning).toBeUndefined();
    expect(off.issues.some((i) => i.card === "short")).toBe(false);
    expect(buildFlow(data({ status: "ready", files: { "long.mp4": "/x" } })).cards.thumbnail).toMatchObject({ state: "skip", subtitle: "không có file" });
  });

  it("Giọng đọc: giọng + thời lượng; Ảnh cảnh: model thật + x/y ảnh, ghi chú khi chỉ là dự kiến", () => {
    const base = buildFlow(data());
    expect(base.cards.tts.metrics).toEqual(["Giọng Algenib", "Thời lượng 18:40"]);
    expect(base.cards.images.ai).toEqual({ label: "gpt-image (gói)", brand: "openai" });
    const progress = { steps: { images: { state: "run" as const, long: { done: 18, total: 30 }, short: { done: 3, total: 5 }, log: [] } } };
    const guess = buildFlow(data({ status: "rendering", progress }, { ai: { image: { model: "flux-1-schnell", source: "configured" } } })).cards.images;
    expect(guess.metrics).toEqual(["21/35 ảnh"]);
    expect(guess.ai).toEqual({ label: "flux-1-schnell", brand: "cloudflare", note: "dự kiến" });
  });

  it("Dựng video: tiến độ cảnh + tên nhạc nền; thiếu nhạc có cảnh báo trong issues", () => {
    const progress = { steps: { video: { state: "run" as const, long: { done: 12, total: 30 }, log: [] } } };
    const run = buildFlow(data({ status: "rendering", progress })).cards.video;
    expect(run.metrics).toEqual(["Dài 12/30", "♪ Dark Fog"]);
    const noMusic = buildFlow(data({ status: "ready", meta: { title: "t", description: "không nhạc", tags: [], shortTitle: "s", shortDescription: "s" } }));
    expect(noMusic.cards.video.metrics).toContain("Chưa có nhạc nền");
    expect(noMusic.issues).toContainEqual({ tone: "warn", text: "Chưa có nhạc nền", card: "video" });
  });

  it("YouTube: link video/Short và chip 'Trong bản gộp chương X–Y' kèm link bản gộp", () => {
    const compiledInto = { id: 55, from: 10, to: 14, videoIds: [31], youtubeVideoId: "ABC", status: "published" };
    const c = buildFlow(data({ youtubeVideoId: "V1", youtubeShortId: "S1", uploadStatus: "scheduled", publishAt: "2026-11-12T12:00:00.000Z" }, { compiledInto })).cards.youtube;
    expect(c.chips).toEqual(["Trong bản gộp chương 10–14"]);
    expect(c.links).toEqual([
      { label: "Video", href: "https://youtu.be/V1" },
      { label: "Short", href: "https://youtu.be/S1" },
      { label: "Bản gộp", href: "https://youtu.be/ABC" },
    ]);
    const noYt = buildFlow(data({}, { compiledInto: { ...compiledInto, youtubeVideoId: null } })).cards.youtube;
    expect(noYt.links).toEqual([{ label: "Bản gộp", href: "/videos/55" }]);
  });

  it("bản gộp: Viết chương/Giọng/Ảnh hiện 'dùng lại từ chương X–Y' thay vì rỗng", () => {
    const meta = { title: "Gộp", description: "d", tags: [], shortTitle: "s", shortDescription: "s", compilation: { seriesId: 1, from: 10, to: 14, videoIds: [1, 2] } };
    const { cards } = buildFlow(data({ status: "rendering", meta }));
    for (const id of ["chapter", "tts", "images"] as const) {
      expect(cards[id]).toMatchObject({ state: "done", subtitle: "dùng lại từ chương 10–14", metrics: ["dùng lại từ chương 10–14"] });
    }
    expect(cards.video.state).toBe("run");
  });

  it("subtitle done theo dữ liệu có sẵn", () => {
    const { cards } = buildFlow(data({ status: "ready" }));
    expect(cards.seo.subtitle).toBe("tiêu đề · Short · tag");
    expect(cards.tts.subtitle).toBe("18:40");
    expect(cards.images.subtitle).toBe("có thumbnail");
    const bare = buildFlow(data({ status: "ready", meta: null, durationSec: null })).cards;
    expect(bare.seo.subtitle).toBe("xong");
    expect(bare.tts.subtitle).toBe("xong");
    expect(bare.tts.metrics[1]).toBe("Chưa có thời lượng");
  });

  it("states tổng thể khi upload lỗi: youtube error + issue", () => {
    const r = buildFlow(data({ status: "ready", uploadStatus: "failed", uploadError: "quotaExceeded" }));
    expect(states(data({ status: "ready", uploadStatus: "failed" })).youtube).toBe("error");
    expect(r.issues).toContainEqual({ tone: "error", text: "Upload YouTube lỗi: quotaExceeded", card: "youtube" });
  });
});

describe("formatSlot / formatTime", () => {
  // Không dùng Intl cho thứ: ICU của Node và trình duyệt ra chữ khác nhau → lỗi hydration.
  it("lịch đăng theo giờ Việt Nam, chuỗi cố định", () => {
    expect(formatSlot("2026-11-12T12:00:00.000Z")).toBe("19:00 · T5 12/11");
  });
  it("qua nửa đêm VN thì sang ngày sau, Chủ nhật là CN", () => {
    expect(formatSlot("2026-11-14T17:30:00.000Z")).toBe("00:30 · CN 15/11");
  });
  it("formatTime có giờ và ngày", () => {
    expect(formatTime("2026-11-09T07:32:00.000Z")).toBe("14:32 09/11");
  });
});
