import { describe, expect, it } from "vitest";
import { planChapterScenes } from "./episode-plan";
import { CLIP_END_STRENGTH, CLIP_FRAMES, MOTION_NEGATIVE, MOTION_SUFFIX, buildManifest, clipSegmentArgs, gpuMinutes, kaggleSlug, kernelFailureKind, kernelPhase, kernelPushBody, motionPrompt, parseClipLog, pickClipScenes, splitClipSegment } from "./i2v-plan";

describe("pickClipScenes", () => {
  const spans = planChapterScenes(1800).map((s, i) => ({ ...s, action: i === 30 || i === 40 }));
  it("chọn 5–7 cảnh, tăng dần, không trùng", () => {
    const got = pickClipScenes(spans);
    expect(got.length).toBeGreaterThanOrEqual(5);
    expect(got.length).toBeLessThanOrEqual(7);
    expect(got).toEqual([...new Set(got)].sort((a, b) => a - b));
  });
  it("gồm ảnh đầu tiên và các cảnh action", () => {
    const got = pickClipScenes(spans);
    expect(got[0]).toBe(0);
    expect(got).toContain(30);
    expect(got).toContain(40);
  });
  it("tối đa 3 ảnh từ 2 phút đầu", () => {
    const got = pickClipScenes(spans);
    expect(got.filter((i) => spans[i].zoom).length).toBeLessThanOrEqual(3);
  });
  it("chương ngắn: ít cảnh hơn min thì lấy hết cảnh dùng được", () => {
    expect(pickClipScenes(planChapterScenes(30))).toHaveLength(5);
    expect(pickClipScenes([{ start: 0, end: 10 }, { start: 10, end: 11 }])).toEqual([0]);
  });
  it("nhiều action hơn chỗ trống: không vượt max", () => {
    const many = planChapterScenes(1800).map((s) => ({ ...s, action: true }));
    expect(pickClipScenes(many).length).toBeLessThanOrEqual(7);
  });
});

describe("buildManifest", () => {
  it("mang sẵn negative chung để run.py không giữ bản sao riêng", () => {
    const m = buildManifest([{ id: 0, image: "a.jpg", prompt: "p" }]);
    expect(m.negative).toContain("deformed face");
    expect(m.negative).toBe(MOTION_NEGATIVE);
    expect(m).toMatchObject({ width: 768, height: 448, frames: CLIP_FRAMES, endStrength: CLIP_END_STRENGTH });
  });
  it("ô dò tham số ghi đè được độ khóa / số khung / negative của riêng nó", () => {
    const m = buildManifest([{ id: 0, image: "a.jpg", prompt: "p", endStrength: 0, frames: 73, negative: "khác" }]);
    expect(m.clips[0]).toMatchObject({ endStrength: 0, frames: 73, negative: "khác" });
  });
});

describe("kernel", () => {
  it("push body bật GPU + internet, gắn dataset, private", () => {
    const b = kernelPushBody({ username: "u", slug: "k", title: "t", script: "print(1)", datasetSlug: "d", timeoutSeconds: 3600 });
    expect(b).toMatchObject({ slug: "u/k", enableGpu: true, enableInternet: true, isPrivate: true, kernelType: "script", datasetDataSources: ["u/d"], sessionTimeoutSeconds: 3600 });
  });
  it("slug chỉ gồm a-z0-9-", () => {
    expect(kaggleSlug("data", 27, Date.now())).toMatch(/^mts-i2v-data-27-[a-z0-9]+$/);
  });
  it("manifest 97 khung, kích thước chia hết cho 32", () => {
    const m = buildManifest([{ id: 1, image: "a.jpg", prompt: "p" }]);
    expect(m.frames).toBe(97);
    expect(m.endStrength).toBe(0.5);
    expect(m.width % 32).toBe(0);
    expect(m.height % 32).toBe(0);
  });
  it("trạng thái kernel", () => {
    expect(kernelPhase("running")).toBe("running");
    expect(kernelPhase("KernelWorkerStatus.COMPLETE")).toBe("done");
    expect(kernelPhase("error")).toBe("failed");
    expect(kernelPhase("queued")).toBe("queued");
  });
  it("nhận biết lỗi do thiếu GPU / internet", () => {
    expect(kernelFailureKind("x MTS_NO_GPU y")).toBe("no-gpu");
    expect(kernelFailureKind("MTS_NO_INTERNET")).toBe("no-internet");
    expect(kernelFailureKind("Traceback")).toBe("other");
  });
  it("đọc log từng clip + giờ GPU", () => {
    expect(parseClipLog("a\nMTS_CLIP id=3 ok=1 sec=41.2\nMTS_CLIP id=5 ok=0 sec=2.0")).toEqual([
      { id: 3, ok: true, seconds: 41.2 },
      { id: 5, ok: false, seconds: 2 },
    ]);
    expect(gpuMinutes(0)).toBe(0);
    expect(gpuMinutes(61)).toBe(2);
  });
  it("prompt chuyển động có đuôi giữ mượt", () => {
    expect(motionPrompt("hair flowing. ")).toBe(`hair flowing, ${MOTION_SUFFIX}`);
  });
});

describe("splitClipSegment / clipSegmentArgs", () => {
  it("đoạn ngắn hơn clip: chỉ phát clip, cắt theo đoạn", () => {
    expect(splitClipSegment(60, CLIP_FRAMES)).toEqual({ clipFrames: 60, stillFrames: 0, crossfadeFrames: 0 });
  });
  it("đoạn dài hơn clip: ảnh tĩnh rồi mờ chéo 1 giây sang clip ở cuối, tổng khớp đoạn", () => {
    const s = splitClipSegment(720, CLIP_FRAMES);
    expect(s.clipFrames).toBe(CLIP_FRAMES);
    expect(s.crossfadeFrames).toBe(24);
    expect(s.clipFrames + s.stillFrames - s.crossfadeFrames).toBe(720);
  });
  const base = { clip: "c.mp4", img: "i.jpg", out: "o.mp4", w: 1920, h: 1080 };
  it("upscale lanczos, 24 fps, đúng số khung cuối, timescale trùng đoạn tĩnh", () => {
    const a = clipSegmentArgs({ ...base, frames: 720 });
    const g = a[a.indexOf("-filter_complex") + 1];
    expect(g).toContain("flags=lanczos");
    expect(g).toContain("xfade=transition=fade:duration=1.000");
    expect(g).toContain("[s][c]xfade");
    expect(g).toContain("offset=25.958");
    expect(a[a.indexOf("-frames:v") + 1]).toBe("720");
    expect(a[a.indexOf("-video_track_timescale") + 1]).toBe("12288");
    expect(a.filter((x) => x === "-i")).toHaveLength(2);
  });
  it("đoạn ngắn: một đầu vào, không xfade", () => {
    const a = clipSegmentArgs({ ...base, frames: 60 });
    expect(a.filter((x) => x === "-i")).toHaveLength(1);
    expect(a.join(" ")).not.toContain("xfade");
  });
  it("cắt logo áp lên ảnh tĩnh của đoạn mờ chéo", () => {
    const a = clipSegmentArgs({ ...base, frames: 720, logoCrop: "crop=iw:ih*0.93:0:0," });
    expect(a[a.indexOf("-filter_complex") + 1]).toContain("[1:v]crop=iw:ih*0.93:0:0,");
  });
});
