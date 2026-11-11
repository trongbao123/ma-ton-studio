import { describe, expect, it } from "vitest";
import { buildFlow, type FlowData } from "./model";
import { CARD_GAP, CARD_WIDTH, COL_PITCH, ROW_PITCH, STACK_PITCH } from "./layout";
import { buildSubs, SUB_GAP, SUB_HEIGHT, SUB_HEIGHT_H, SUB_INSET, SUB_WIDTH, SUB_WIDTH_H, subOffset } from "./subnodes";

function data(extra: Partial<FlowData> = {}, meta: Partial<NonNullable<FlowData["video"]["meta"]>> = {}): FlowData {
  return {
    video: {
      id: 1,
      status: "ready",
      error: null,
      runUrl: null,
      publishAt: "2026-11-12T12:00:00.000Z",
      durationSec: 600,
      youtubeUrl: null,
      meta: { title: "t", description: `d\n\nNhạc nền: "Dark Fog" – Kevin MacLeod (incompetech.com)`, tags: [], shortTitle: "s", shortDescription: "sd", seo: { keywords: ["a", "b"], titleScore: 95 }, ...meta },
      files: {},
      createdAt: "2026-11-09T07:00:00.000Z",
      updatedAt: "2026-11-09T07:30:00.000Z",
      progress: { steps: { agent: { state: "done", model: "gpt-5", log: [] } } },
      uploadStatus: "none",
      uploadError: null,
      youtubeVideoId: null,
      youtubeShortId: null,
    },
    chapter: { id: 1, number: 1, title: "c", words: 100, content: "x", outline: "o", approvedAt: "2026-11-09T07:00:00.000Z" },
    series: { id: 1, title: "S", bibleExcerpt: "bible", voiceStyle: "v", ttsVoice: "Rites", makeShort: true, autoPublish: true },
    prevSummary: null,
    youtube: { connected: false, channel: null },
    trends: null,
    compiledInto: null,
    ai: { image: { model: "gpt-image (gói Plus)", source: "tracked" }, text: { story: [{ provider: "claude-cli", model: "haiku" }], meta: [], scenes: [] }, available: ["claude-cli"] },
    ...extra,
  };
}

const subsOf = (d: FlowData) => buildSubs(d, buildFlow(d).cards);
const byId = (d: FlowData) => Object.fromEntries(subsOf(d).map((s) => [s.id, s]));

describe("buildSubs", () => {
  it("hiện giá trị thật: model chương, điểm vidIQ, nhạc, lịch", () => {
    const s = byId(data());
    expect(s["chapter-model"]).toMatchObject({ parent: "chapter", ok: true });
    expect(s["chapter-model"].value).toContain("haiku");
    expect(s["seo-vidiq"]).toMatchObject({ value: "95đ", ok: true });
    expect(s["images-model"]).toMatchObject({ parent: "images", value: "gpt-image (gói Plus)", ok: true });
    expect(s["video-music"]).toMatchObject({ value: "Dark Fog", ok: true });
    expect(s["youtube-slot"]).toMatchObject({ value: "19:00 12/11", ok: true });
  });

  it("thiếu dữ liệu thì mờ (ok=false) chứ không bịa", () => {
    const s = byId(data({ prevSummary: null }, { seo: undefined, description: "không nhạc" }));
    expect(s["chapter-summary"].ok).toBe(false);
    expect(s["seo-vidiq"]).toMatchObject({ value: "—", ok: false });
    expect(s["video-music"]).toMatchObject({ value: "—", ok: false });
  });

  it("không có điểm tiêu đề thì hiện số từ khóa vidIQ", () => {
    expect(byId(data({}, { seo: { keywords: ["a", "b", "c"] } }))["seo-vidiq"].value).toBe("3 từ khóa");
  });

  it("bản gộp: bỏ node con của Viết chương", () => {
    const d = data({}, { compilation: { seriesId: 1, from: 1, to: 3, videoIds: [1, 2, 3] } });
    expect(subsOf(d).map((s) => s.parent)).toEqual(["trends", "trends", "seo", "seo", "thumbnail", "video", "video", "short", "short", "youtube", "youtube", "youtube"]);
  });

  it("Xu hướng: vidIQ theo thời điểm quét, Chat model là AI đầu chuỗi meta", () => {
    const meta = [{ provider: "claude-cli" as const, model: "gpt-6-luna" }];
    const d = data({ ai: { ...data().ai, text: { story: [], meta, scenes: [] } }, trends: { scannedAt: "2026-11-10T02:00:00.000Z", fresh: true, summary: "", hotTopics: [], titlePatterns: [], risingKeywords: [] } });
    const s = byId(d);
    expect(s["trends-vidiq"]).toMatchObject({ value: "09:00 10/11", ok: true });
    expect(s["trends-model"]).toMatchObject({ value: "gpt-6-luna", ok: true });
    expect(byId(data())["trends-vidiq"]).toMatchObject({ value: "—", ok: false });
    expect(byId(data())["trends-model"]).toMatchObject({ value: "—", ok: false });
  });

  it("Giọng đọc: TTS model (mặc định Gemini TTS, hoặc model đã ghi) và giọng của bộ truyện", () => {
    expect(byId(data())["tts-model"].value).toBe("Gemini TTS");
    expect(byId(data())["tts-voice"]).toMatchObject({ value: "Rites", ok: true });
    const tracked = data();
    tracked.video.progress = { steps: { tts: { state: "done", model: "gemini-3.8-flash-tts", log: [] } } };
    expect(byId(tracked)["tts-model"].value).toBe("gemini-3.8-flash-tts");
    expect(byId(data({ series: { ...data().series, ttsVoice: "" } }))["tts-voice"]).toMatchObject({ value: "—", ok: false });
  });

  it("Ảnh cảnh / Thumbnail / Short dùng model vẽ thật; Prompt cảnh theo chuỗi scenes", () => {
    const d = data({ ai: { ...data().ai, text: { story: [], meta: [], scenes: [{ provider: "claude-cli", model: "haiku" }] } } });
    const s = byId(d);
    expect(s["thumbnail-model"].value).toBe("gpt-image (gói Plus)");
    expect(s["short-model"].value).toBe("gpt-image (gói Plus)");
    expect(s["images-prompt"]).toMatchObject({ value: "haiku", ok: true });
    expect(byId(data())["images-prompt"]).toMatchObject({ value: "—", ok: false });
    expect(byId(data({ ai: { ...data().ai, image: { model: "flux-1-schnell", source: "configured" } } }))["images-model"].ok).toBe(false);
  });

  it("Short tắt thì không có node con Short; Danh sách phát theo app_settings", () => {
    expect(subsOf(data({ series: { ...data().series, makeShort: false } })).some((s) => s.parent === "short")).toBe(false);
    expect(byId(data())["youtube-playlist"]).toMatchObject({ value: "—", ok: false });
    expect(byId(data({ youtube: { connected: true, channel: null, playlistId: "PL1" } }))["youtube-playlist"]).toMatchObject({ value: "Có", ok: true });
  });

  it("mọi node con có id duy nhất, thẻ cha nào cũng không quá 4 node con", () => {
    const subs = subsOf(data());
    expect(new Set(subs.map((s) => s.id)).size).toBe(subs.length);
    const perParent = Object.values(Object.groupBy(subs, (s) => s.parent)).map((x) => x?.length ?? 0);
    expect(Math.max(...perParent)).toBeLessThanOrEqual(4);
  });
});

describe("bố cục mặc định không đè nhau", () => {
  const maxSubs = Math.max(...Object.values(Object.groupBy(subsOf(data()), (s) => s.parent)).map((x) => x?.length ?? 0));

  it("ngang: hàng node con vừa khoảng cách giữa hai cột thẻ", () => {
    const rowWidth = maxSubs * SUB_WIDTH_H + (maxSubs - 1) * 10;
    expect(rowWidth).toBeLessThanOrEqual(COL_PITCH - 20);
    expect(subOffset(0, CARD_WIDTH, true, maxSubs).x).toBeGreaterThanOrEqual(-(COL_PITCH - CARD_WIDTH) / 2);
  });

  it("ngang: nhánh xếp chồng chừa chỗ cho hàng node con dưới thẻ", () => {
    const bottom = subOffset(0, CARD_WIDTH, true, 2).y + SUB_HEIGHT_H;
    expect(STACK_PITCH).toBeGreaterThan(bottom);
  });

  it("dọc: cột node con của thẻ nhánh lọt giữa hai thẻ nhánh cạnh nhau", () => {
    expect(SUB_INSET + SUB_WIDTH).toBeLessThan(CARD_GAP);
  });

  it("dọc: cột node con không cao hơn một hàng thẻ", () => {
    const column = 8 + maxSubs * SUB_HEIGHT + (maxSubs - 1) * SUB_GAP;
    expect(column).toBeLessThan(ROW_PITCH + 40);
  });
});

describe("subOffset", () => {
  it("xếp cột bên phải thẻ cha, mỗi node con một dòng", () => {
    expect(subOffset(0, 248).x).toBe(248 + SUB_INSET);
    expect(subOffset(2, 248).x).toBe(subOffset(0, 248).x);
    expect(subOffset(1, 248).y - subOffset(0, 248).y).toBe(SUB_HEIGHT + SUB_GAP);
  });
});
