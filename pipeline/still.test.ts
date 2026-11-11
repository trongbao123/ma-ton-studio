import { describe, expect, it } from "vitest";
import { AMBIENT_GAIN, MUSIC_GAIN, STILL_TIMESCALE, conformArgs, episodeAudioGraph, episodeMuxArgs, parseIntegratedLufs, stillFrames, stillSegmentArgs, voiceGainDb } from "./still";

describe("stillFrames", () => {
  it("làm tròn theo mốc cộng dồn: tổng các đoạn bằng đúng số khung của cả timeline", () => {
    const ends = [10.03, 20.07, 30.11, 40.2];
    const frames = ends.map((e, i) => stillFrames(i ? ends[i - 1] : 0, e));
    expect(frames.reduce((a, b) => a + b, 0)).toBe(Math.round(40.2 * 24));
  });
  it("đoạn cực ngắn vẫn có ít nhất 1 khung", () => {
    expect(stillFrames(5, 5.001)).toBe(1);
  });
});

describe("stillSegmentArgs", () => {
  const args = stillSegmentArgs({ img: "a.jpg", out: "o.mp4", frames: 1440, w: 1920, h: 1080, logoCrop: "crop=iw:ih*0.93:0:0," });
  const vf = args[args.indexOf("-vf") + 1];
  it("ảnh ở 24 fps, nhân 1 khung thành đúng số khung, không zoompan/xfade", () => {
    expect(args.slice(0, 4)).toEqual(["-framerate", "24", "-i", "a.jpg"]);
    expect(args[args.indexOf("-frames:v") + 1]).toBe("1440");
    expect(vf.indexOf("loop=loop=-1:size=1")).toBeGreaterThan(vf.indexOf("crop=1920"));
    expect(vf).not.toMatch(/zoompan|xfade/);
  });
  it("scale/crop 1 lần ra 1920x1080, logo cắt trước", () => {
    expect(vf.startsWith("crop=iw:ih*0.93:0:0,scale=1920:1080")).toBe(true);
    expect(vf.match(/scale=/g)).toHaveLength(1);
  });
  it("mờ vào đầu và mờ ra 0,5s ở cuối (60s → bắt đầu ở 59,5s)", () => {
    expect(vf).toContain("fade=t=in:st=0:d=0.5");
    expect(vf).toContain("fade=t=out:st=59.500:d=0.5");
  });
  it("đoạn quá ngắn thì mờ tối đa nửa đoạn", () => {
    const v = stillSegmentArgs({ img: "a", out: "o", frames: 12, w: 1920, h: 1080 });
    expect(v[v.indexOf("-vf") + 1]).toContain("fade=t=in:st=0:d=0.25");
  });
  it("encode libx264 tune stillimage", () => {
    expect(args).toContain("stillimage");
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
  });
});

describe("episodeMuxArgs", () => {
  const base = { list: "l.txt", narration: "n.wav", music: "m.mp3", seconds: 2400, voiceGain: 13.5, out: "o.mp4" };
  it("video copy, AAC 192k stereo 48k", () => {
    const a = episodeMuxArgs({ ...base, isAmbient: false });
    expect(a[a.indexOf("-c:v") + 1]).toBe("copy");
    expect(a[a.indexOf("-b:a") + 1]).toBe("192k");
    expect(a[a.indexOf("-ar") + 1]).toBe("48000");
    expect(a[a.indexOf("-ac") + 1]).toBe("2");
  });
  it("nhạc lặp vô hạn nhưng cắt đúng thời lượng giọng", () => {
    const a = episodeMuxArgs({ ...base, isAmbient: false });
    expect(a.slice(a.indexOf("-stream_loop"), a.indexOf("-stream_loop") + 5)).toEqual(["-stream_loop", "-1", "-t", "2400.00", "-i"]);
  });
  it("nền ambient to hơn nhạc thật", () => {
    expect(episodeMuxArgs({ ...base, isAmbient: true }).join(" ")).toContain(`volume=${AMBIENT_GAIN}`);
    expect(episodeMuxArgs({ ...base, isAmbient: false }).join(" ")).toContain(`volume=${MUSIC_GAIN}`);
  });
});

describe("episodeAudioGraph", () => {
  const g = episodeAudioGraph({ seconds: 2400, musicGain: 0.18, voiceGain: 13.5 });
  it("giọng nhân gain đã đo, nhạc tự hạ theo giọng, chặn đỉnh", () => {
    expect(g).toContain("[1:a]volume=13.50dB");
    expect(g).not.toContain("loudnorm");
    expect(g).toContain("sidechaincompress");
    expect(g).toContain("alimiter");
  });
  it("không đo được thì rơi về loudnorm -16 LUFS", () => {
    expect(episodeAudioGraph({ seconds: 2400, musicGain: 0.18, voiceGain: null })).toContain("loudnorm=I=-16");
  });
  it("nhạc mờ vào 3s và mờ ra 5s cuối", () => {
    expect(g).toContain("afade=t=in:st=0:d=3");
    expect(g).toContain("afade=t=out:st=2395.00:d=5");
  });
});

describe("parseIntegratedLufs / voiceGainDb", () => {
  const summary = "  Integrated loudness:\n    I:         -29.4 LUFS\n    Threshold: -39.5 LUFS\n\n  Loudness range:\n    LRA:         0.1 LU";
  it("đọc I: từ bản tóm tắt ebur128 (không nhầm LRA)", () => {
    expect(parseIntegratedLufs(summary)).toBe(-29.4);
  });
  it("im lặng (-inf) hoặc không có tóm tắt thì null", () => {
    expect(parseIntegratedLufs("    I:         -inf LUFS")).toBeNull();
    expect(parseIntegratedLufs("lỗi gì đó")).toBeNull();
  });
  it("gain = -16 trừ độ to đã đo", () => {
    expect(voiceGainDb(-29.4)).toBeCloseTo(13.4, 5);
    expect(voiceGainDb(-12)).toBeCloseTo(-4, 5);
  });
  it("kẹp gain trong [-20, +30] dB; không đo được thì null", () => {
    expect(voiceGainDb(-80)).toBe(30);
    expect(voiceGainDb(10)).toBe(-20);
    expect(voiceGainDb(null)).toBeNull();
  });
});

describe("conformArgs", () => {
  it("đưa clip mở đầu về đúng thông số chương tĩnh để concat copy", () => {
    const a = conformArgs({ input: "cold.mp4", out: "c.mp4", w: 1920, h: 1080 }).join(" ");
    expect(a).toContain("fps=24");
    expect(a).toContain("-r 24");
    expect(a).toContain(`-video_track_timescale ${STILL_TIMESCALE}`);
    expect(a).toContain("-ar 48000 -ac 2");
    expect(a).toContain("loudnorm=I=-16");
    expect(a.endsWith("c.mp4")).toBe(true);
  });
});

describe("stillSegmentArgs zoom", () => {
  const vf = (a: string[]) => a[a.indexOf("-vf") + 1];
  it("zoom dùng zoompan đúng số khung, ảnh tĩnh thì không", () => {
    const z = vf(stillSegmentArgs({ img: "a", out: "o", frames: 144, w: 1920, h: 1080, zoom: true }));
    expect(z).toMatch(/zoompan=.*d=144:s=1920x1080:fps=24/);
    expect(z).not.toMatch(/loop=loop/);
    expect(vf(stillSegmentArgs({ img: "a", out: "o", frames: 144, w: 1920, h: 1080 }))).not.toMatch(/zoompan/);
  });
});
