import { describe, expect, it } from "vitest";
import { AMBIENT_GAIN, MUSIC_GAIN, SFX_GAIN, STILL_TIMESCALE, conformArgs, episodeAudioGraph, episodeMuxArgs, parseIntegratedLufs, stillFrames, stillSegmentArgs, voiceGainDb } from "./still";

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
  it("cắt THẲNG giữa các cảnh (kênh top không mờ qua đen) — không có bộ lọc fade", () => {
    expect(vf).not.toContain("fade=");
  });
  it("có phụ đề thì đốt ASS của đoạn ở cuối chuỗi lọc", () => {
    const v = stillSegmentArgs({ img: "a", out: "o", frames: 48, w: 1920, h: 1080, subs: "/tmp/x-subs.ass" });
    expect(v[v.indexOf("-vf") + 1]).toMatch(/,ass=.*x-subs\.ass:fontsdir=/);
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
  it("không có track hiệu ứng thì vẫn đúng 3 input như cũ", () => {
    const a = episodeMuxArgs({ ...base, isAmbient: false });
    expect(a.filter((x) => x === "-i")).toHaveLength(3);
  });
  it("có track hiệu ứng: thành input thứ 4, sau nhạc", () => {
    const a = episodeMuxArgs({ ...base, isAmbient: false, sfx: "sfx.wav" });
    expect(a.filter((x) => x === "-i")).toHaveLength(4);
    expect(a.lastIndexOf("-i")).toBe(a.indexOf("sfx.wav") - 1);
    expect(a.indexOf("sfx.wav")).toBeGreaterThan(a.indexOf("m.mp3"));
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
  it("không có hiệu ứng: trộn 2 nguồn (giọng + nhạc đã hạ)", () => {
    expect(g).toContain("amix=inputs=2");
    expect(g).not.toContain("[3:a]");
  });
  it("có hiệu ứng: input thứ 4 hạ tiếng rồi trộn 3 nguồn, KHÔNG sidechain theo giọng", () => {
    const s = episodeAudioGraph({ seconds: 2400, musicGain: 0.18, voiceGain: 13.5, sfx: true });
    expect(s).toContain(`[3:a]`);
    expect(s).toContain(`volume=${SFX_GAIN}`);
    expect(s).toContain("amix=inputs=3");
    expect(s.match(/sidechaincompress/g)).toHaveLength(1);
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

describe("stillSegmentArgs + parallax", () => {
  const files = { farFill: "a.ppm", farPatch: "b.pgm", midFill: "c.ppm", midPatch: "d.pgm", midAlpha: "e.pgm", nearAlpha: "f.pgm" };
  const args = stillSegmentArgs({ img: "a.jpg", out: "o.mp4", frames: 192, w: 1920, h: 1080, logoCrop: "crop=iw:ih*0.93:0:0,", parallax: { files, motion: "truckLeft", motionFrames: 144 } });
  const graph = args[args.indexOf("-filter_complex") + 1];
  it("đủ 7 đầu vào (ảnh + 6 file), đúng số khung, map nhãn đã mờ vào/ra", () => {
    expect(args.filter((a) => a === "-i")).toHaveLength(7);
    expect(args[args.indexOf("-frames:v") + 1]).toBe("192");
    expect(args[args.indexOf("-map") + 1]).toBe("[out]");
    expect(graph).toContain("[v]null[out]");
  });
  it("chỉ motionFrames khung đầu qua đồ thị 3 lớp, phần còn lại nhân bản khung cuối để đoạn vẫn đủ 192 khung", () => {
    expect(graph).toContain("min(on,144)");
    expect(graph).toContain("d=144:");
    expect(graph).toContain("tpad=stop_mode=clone:stop=48");
  });
  it("cùng thông số mã hoá h264 24fps như đoạn tĩnh nhưng không tune stillimage", () => {
    expect(args).not.toContain("stillimage");
    expect(args[args.indexOf("-r") + 1]).toBe("24");
    expect(args[args.indexOf("-crf") + 1]).toBe("23");
    expect(args[args.indexOf("-g") + 1]).toBe("120");
  });
  it("motionFrames lớn hơn đoạn thì kẹp bằng đoạn", () => {
    const a = stillSegmentArgs({ img: "a", out: "o", frames: 100, w: 1920, h: 1080, parallax: { files, motion: "dollyIn", motionFrames: 999 } });
    const g = a[a.indexOf("-filter_complex") + 1];
    expect(g).toContain("min(on,100)");
    expect(g).not.toContain("tpad");
  });
});

describe("stillSegmentArgs · cảnh hành động", () => {
  const base = { img: "a.jpg", out: "o.mp4", frames: 24 * 8, w: 1920, h: 1080 };
  const vfOf = (o: Parameters<typeof stillSegmentArgs>[0]) => {
    const a = stillSegmentArgs(o);
    const i = a.indexOf("-vf");
    return i >= 0 ? a[i + 1] : a[a.indexOf("-filter_complex") + 1];
  };

  it("chớp trắng ở cú cắt — fade vào TỪ MÀU TRẮNG, không phải từ đen như cảnh thường", () => {
    expect(vfOf({ ...base, action: true })).toContain("color=white");
    expect(vfOf(base)).not.toContain("color=white");
  });

  it("đẩy ống kính vào nhanh hơn hẳn cảnh thường", () => {
    const act = vfOf({ ...base, action: true });
    const calm = vfOf({ ...base, zoom: true });
    const amount = (s: string) => Number(s.match(/z='1\+([\d.]+)\*on/)?.[1] ?? 0);
    expect(amount(act)).toBeGreaterThan(amount(calm));
  });

  it("rung KHÔNG được lộ viền đen — phải cắt từ khung rộng hơn, không phải chèn pad đen rồi dịch", () => {
    const vf = vfOf({ ...base, action: true });
    expect(vf).not.toContain("pad=");
    // zoompan phải xuất khung RỘNG HƠN đích để còn dư điểm ảnh mà dịch.
    const s = vf.match(/zoompan=[^,]*:s=(\d+)x(\d+)/);
    expect(s, "thiếu s= trong zoompan").toBeTruthy();
    expect(Number(s![1])).toBeGreaterThan(base.w);
    expect(Number(s![2])).toBeGreaterThan(base.h);
  });

  it("rung khung lúc va chạm rồi đứng yên, không rung suốt cảnh", () => {
    const vf = vfOf({ ...base, action: true });
    expect(vf).toMatch(/crop=/);
    // Biên độ rung tắt dần theo t: phải có điều kiện thời gian, không rung đều mãi.
    expect(vf).toMatch(/lt\(t,[\d.]+\)/);
  });

  it("vẫn ra đúng số khung, chớp trắng ở cú cắt, không mờ ra đen ở cuối (cắt thẳng)", () => {
    const a = stillSegmentArgs({ ...base, action: true });
    expect(a[a.indexOf("-frames:v") + 1]).toBe(String(base.frames));
    expect(vfOf({ ...base, action: true })).toContain("color=white");
    expect(vfOf({ ...base, action: true })).not.toContain("fade=t=out");
  });

  it("cảnh thường không đổi gì — không rung, không chớp", () => {
    const vf = vfOf(base);
    expect(vf).not.toContain("color=white");
    expect(vf).not.toMatch(/sin\(/);
  });
});
