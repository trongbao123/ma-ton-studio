import { describe, expect, it } from "vitest";
import { CLIP_FRAMES } from "./i2v-plan";
import { SFX_KINDS, SFX_SECONDS, SFX_TRIM_DB, sfxCutEvents, sfxEvents, sfxImpactEvents, sfxKinds, sfxSource, sfxTrackArgs } from "./sfx";
import { SFX_GAIN, STILL_FPS } from "./still";

/** Cảnh dài 60 giây liên tiếp như chương thật (1 ảnh/60 giây). */
const spans = (count: number, seconds = 60) => Array.from({ length: count }, (_, i) => ({ start: i * seconds, end: (i + 1) * seconds }));
const clip = (scene: number, motion: string) => ({ scene, motion, file: `long-clip-${scene}.mp4` });

describe("sfxKinds", () => {
  it("sét/sấm từ prompt lightning", () => {
    expect(sfxKinds("golden lightning crackling across the sky")).toEqual(["thunder"]);
  });
  it("hào quang + nổ: tối đa 2 loại, theo thứ tự ưu tiên (nổ trước hào quang)", () => {
    expect(sfxKinds("qi aura erupting, energy shockwave rippling outward")).toEqual(["boom", "energy"]);
  });
  it("prompt nhiều thứ vẫn chỉ lấy 2", () => {
    expect(sfxKinds("lightning, explosion, aura, wind, flames")).toHaveLength(2);
  });
  it("không khớp gì thì một tiếng gió", () => {
    expect(sfxKinds("the character stands still")).toEqual(["whoosh"]);
  });
});

describe("sfxEvents", () => {
  const scenes = spans(5);
  it("clip nằm cuối đoạn: tiếng đặt ở giữa lúc mờ chéo vào clip, không ở đầu cảnh", () => {
    const [e] = sfxEvents([clip(0, "golden lightning crackling")], scenes, 300);
    const split = { still: 1440 - CLIP_FRAMES + STILL_FPS, xf: STILL_FPS };
    expect(e.kind).toBe("thunder");
    expect(e.at).toBeCloseTo((split.still - split.xf / 2) / STILL_FPS + 0.5, 3);
  });
  it("cảnh ngắn hơn clip: clip chạy từ đầu đoạn nên tiếng tính từ mốc cảnh", () => {
    const short = [{ start: 10, end: 13 }];
    const [e] = sfxEvents([clip(0, "aura")], short, 60);
    expect(e.at).toBeCloseTo(10 - 0.3, 3);
  });
  it("mốc không bao giờ âm", () => {
    const [e] = sfxEvents([clip(0, "aura")], [{ start: 0, end: 3 }], 60);
    expect(e.at).toBe(0);
  });
  it("sắp xếp tăng dần theo mốc", () => {
    const got = sfxEvents([clip(3, "lightning"), clip(0, "explosion"), clip(1, "aura")], scenes, 300);
    expect(got.map((e) => e.at)).toEqual([...got.map((e) => e.at)].sort((a, b) => a - b));
  });
  it("clip chưa có file (GPU lỗi → vẫn là ảnh tĩnh) thì không kêu gì", () => {
    expect(sfxEvents([{ scene: 0, motion: "lightning" }], scenes, 300)).toEqual([]);
  });
  it("bỏ mốc vượt quá độ dài chương", () => {
    expect(sfxEvents([clip(4, "lightning")], scenes, 250)).toEqual([]);
  });
  it("bỏ cảnh không có trong danh sách", () => {
    expect(sfxEvents([clip(99, "lightning")], scenes, 300)).toEqual([]);
  });
});

describe("sfxCutEvents (tiếng đập theo nhịp cắt của intro)", () => {
  const scenes = [{ start: 0, end: 4 }, { start: 4, end: 7.5 }, { start: 7.5, end: 11 }, { start: 11, end: 15 }];

  it("một tiếng cho mỗi lần đổi ảnh, KHÔNG có tiếng ở giây 0 (chưa cắt gì đã đập là vô lý)", () => {
    const got = sfxCutEvents(scenes, 15);
    expect(got).toHaveLength(scenes.length - 1);
    expect(got.every((e) => e.at > 0)).toBe(true);
  });
  it("tiếng rơi đúng lúc đổi ảnh", () => {
    expect(sfxCutEvents(scenes, 15).map((e) => e.at)).toEqual([4, 7.5, 11]);
  });
  it("đổi loại tiếng liên tiếp — 3 cú sấm giống hệt nghe như lỗi băng", () => {
    const kinds = sfxCutEvents(scenes, 15).map((e) => e.kind);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
  });
  it("bỏ mốc rơi ra ngoài đoạn", () => {
    expect(sfxCutEvents(scenes, 8).map((e) => e.at)).toEqual([4, 7.5]);
  });
  it("một ảnh duy nhất thì không có nhịp cắt nào", () => {
    expect(sfxCutEvents([{ start: 0, end: 10 }], 10)).toEqual([]);
  });
});

describe("sfxSource", () => {
  it("mỗi loại là đồ thị lavfi tự sinh, không đọc file ngoài", () => {
    for (const kind of SFX_KINDS) {
      const src = sfxSource(kind);
      expect(src).toMatch(/^(sine|anoisesrc)=/);
      expect(src).toContain(`d=${SFX_SECONDS[kind]}`);
      expect(src).not.toMatch(/-i |movie=|amovie=/);
    }
  });
  it("mọi nguồn đều 48 kHz như track tập", () => {
    for (const kind of SFX_KINDS) expect(sfxSource(kind)).toContain("r=48000");
  });
});

describe("tiếng dựng lại giống nhau (seed cố định)", () => {
  it("mọi nguồn nhiễu đều có seed — không thì mỗi lần dựng ra một file khác, đo mức không lặp lại được", () => {
    for (const kind of SFX_KINDS) {
      const sources = sfxSource(kind).match(/anoisesrc=[^,;]+/g) ?? [];
      expect(sources.length).toBeGreaterThan(0);
      for (const src of sources) expect(src).toMatch(/[:=]s=\d+/);
    }
  });
  it("2 tiếng cùng loại trong một chương dùng seed khác nhau — không nghe như lặp lại y nguyên", () => {
    const g = sfxTrackArgs([{ kind: "boom", at: 1 }, { kind: "boom", at: 9 }], 60, "o.wav")[1];
    const seeds = [...g.matchAll(/:s=(\d+)/g)].map((m) => m[1]);
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
  it("cùng vị trí thì seed không đổi giữa 2 lần dựng", () => {
    const of = () => sfxTrackArgs([{ kind: "thunder", at: 4 }], 60, "o.wav")[1];
    expect(of()).toBe(of());
  });
});

describe("cân biên độ giữa các loại", () => {
  it("loại nào cũng có mức bù riêng (đo bằng ebur128, xem scripts/sfx-measure.mjs)", () => {
    for (const kind of SFX_KINDS) expect(typeof SFX_TRIM_DB[kind]).toBe("number");
  });
  it("mức bù được áp thật vào cuối chuỗi lọc", () => {
    for (const kind of SFX_KINDS) expect(sfxSource(kind)).toContain(`volume=${SFX_TRIM_DB[kind]}dB`);
  });
  it("tiếng nổ/sấm là điểm nhấn, to hơn nền ì ầm và tiếng gió", () => {
    expect(SFX_TRIM_DB.boom).toBeGreaterThan(SFX_TRIM_DB.rumble);
    expect(SFX_TRIM_DB.boom).toBeGreaterThan(SFX_TRIM_DB.whoosh);
  });
});

describe("sfxTrackArgs", () => {
  const out = "sfx.wav";
  const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1];

  it("mỗi tiếng đặt đúng mốc bằng adelay (ms) rồi trộn với nền im lặng", () => {
    const args = sfxTrackArgs([{ kind: "thunder", at: 12.5 }], 60, out);
    const g = graphOf(args);
    expect(g).toContain("adelay=12500:all=1");
    expect(g).toContain("amix=inputs=2");
    expect(args.slice(-5)).toEqual(["-map", "[a]", "-c:a", "pcm_s16le", out]);
  });

  it("nhãn trung gian đổi tên theo từng tiếng — 2 tiếng cùng loại không trùng nhãn", () => {
    const g = graphOf(sfxTrackArgs([{ kind: "boom", at: 1 }, { kind: "boom", at: 9 }], 60, out));
    const labels = [...g.matchAll(/\[([a-z]\d_\d)\]/g)].map((m) => m[1]);
    expect(new Set(labels).size).toBeGreaterThan(0);
    expect(g).not.toMatch(/\[b0\]/);
    expect(labels.filter((l) => l.endsWith("_0")).length).toBeGreaterThan(0);
    expect(labels.filter((l) => l.endsWith("_1")).length).toBeGreaterThan(0);
  });

  it("không có tiếng nào: track im lặng, không amix rỗng", () => {
    const g = graphOf(sfxTrackArgs([], 60, out));
    expect(g).not.toContain("amix");
    expect(g).toContain("60.00");
  });

  it("chặn đỉnh và ra stereo cho khớp track tập", () => {
    const g = graphOf(sfxTrackArgs([{ kind: "rumble", at: 3 }], 60, out));
    expect(g).toContain("alimiter");
    expect(g).toContain("channel_layouts=stereo");
  });
});

describe("SFX_GAIN", () => {
  // Đo thật (scripts/sfx-measure.mjs --mix): từ 1,5 trở lên đỉnh thật của cả tập vượt 0 dBFS dù đã có alimiter.
  it("không vượt 1 — trên mức đó cả tập bị vỡ đỉnh", () => {
    expect(SFX_GAIN).toBeGreaterThan(0);
    expect(SFX_GAIN).toBeLessThanOrEqual(1);
  });
});

describe("sfxImpactEvents (tiếng va chạm cho cảnh đánh nhau)", () => {
  const scenes = [
    { start: 0, end: 60 },
    { start: 60, end: 120, action: true },
    { start: 120, end: 180 },
    { start: 180, end: 240, action: true },
  ];

  it("chỉ cảnh có cờ action mới có tiếng, đúng lúc vào cảnh", () => {
    const got = sfxImpactEvents(scenes, 300);
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.at)).toEqual([60, 180]);
  });
  it("là tiếng đập mạnh, không phải tiếng gió", () => {
    expect(sfxImpactEvents(scenes, 300).every((e) => e.kind === "boom" || e.kind === "thunder")).toBe(true);
  });
  it("không có cảnh action thì im", () => {
    expect(sfxImpactEvents([{ start: 0, end: 60 }], 300)).toEqual([]);
  });
  it("bỏ mốc ngoài chương", () => {
    expect(sfxImpactEvents(scenes, 100).map((e) => e.at)).toEqual([60]);
  });
});
