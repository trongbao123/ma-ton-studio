import { describe, expect, it } from "vitest";
import { buildFlow, type FlowData } from "./model";
import { buildSubs, SUB_HEIGHT, SUB_GAP, SUB_INSET, subOffset } from "./subnodes";

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
    expect(s["images-model"]).toBeUndefined();
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
    expect(subsOf(d).map((s) => s.parent)).toEqual(["seo", "seo", "video", "youtube", "youtube"]);
  });
});

describe("subOffset", () => {
  it("xếp cột bên phải thẻ cha, mỗi node con một dòng", () => {
    expect(subOffset(0, 248).x).toBe(248 + SUB_INSET);
    expect(subOffset(2, 248).x).toBe(subOffset(0, 248).x);
    expect(subOffset(1, 248).y - subOffset(0, 248).y).toBe(SUB_HEIGHT + SUB_GAP);
  });
});
