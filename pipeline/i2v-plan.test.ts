import { describe, expect, it } from "vitest";
import { planChapterScenes } from "./episode-plan";
import { CLIP_END_STRENGTH, CLIP_FRAMES, OPENER_CLIPS, MOTION_NEGATIVE, MOTION_SUFFIX, buildManifest, datasetFiles, manifestJobs, clipSegmentArgs, gpuMinutes, kaggleSlug, kernelFailureKind, kernelPhase, kernelPushBody, motionPrompt, parseClipLog, pickClipScenes, splitClipSegment } from "./i2v-plan";

describe("pickClipScenes", () => {
  const spans = planChapterScenes(1800).map((s, i) => ({ ...s, action: i === 30 || i === 40 }));
  it("chọn 20–24 cảnh, tăng dần, không trùng", () => {
    const got = pickClipScenes(spans);
    expect(got.length).toBeGreaterThanOrEqual(20);
    expect(got.length).toBeLessThanOrEqual(24);
    expect(got).toEqual([...new Set(got)].sort((a, b) => a - b));
  });
  it("gồm ảnh đầu tiên và các cảnh action", () => {
    const got = pickClipScenes(spans);
    expect(got[0]).toBe(0);
    expect(got).toContain(30);
    expect(got).toContain(40);
  });
  it("tối đa 10 ảnh từ 2 phút đầu", () => {
    const got = pickClipScenes(spans);
    expect(got.filter((i) => spans[i].zoom).length).toBeLessThanOrEqual(10);
  });
  it("chương ngắn: ít cảnh hơn min thì lấy hết cảnh dùng được", () => {
    expect(pickClipScenes(planChapterScenes(30))).toHaveLength(5);
    expect(pickClipScenes([{ start: 0, end: 10 }, { start: 10, end: 11 }])).toEqual([0]);
  });
  it("nhiều action hơn chỗ trống: không vượt max", () => {
    const many = planChapterScenes(1800).map((s) => ({ ...s, action: true }));
    expect(pickClipScenes(many).length).toBeLessThanOrEqual(24);
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

describe("buildManifest · báo tiến độ", () => {
  const progress = { url: "https://x.vercel.app/api/i2v/progress", token: "t", slug: "mts-i2v-run-0-abc", videoId: 7 };
  it("có cấu hình thì kernel biết POST về đâu", () => {
    expect(buildManifest([], 42, undefined, progress).progress).toEqual(progress);
  });
  it("KHÔNG có cấu hình thì manifest không mang token nào — đừng rải bí mật vào dataset khi không cần", () => {
    const m = buildManifest([], 42);
    expect(m).not.toHaveProperty("progress");
    expect(JSON.stringify(m)).not.toContain("token");
  });
});

describe("datasetFiles", () => {
  const manifest = { name: "manifest.json", path: "/w/manifest.json" };
  it("nhiều ô dò dùng CHUNG một ảnh thì chỉ gửi ảnh đó một lần — Kaggle từ chối dataset có đường dẫn trùng", () => {
    const jobs = [0, 1, 2].map((id) => ({ id, image: "in.jpg", prompt: "p", file: "/w/in.jpg" }));
    const got = datasetFiles(manifest, jobs);
    expect(got).toEqual([manifest, { name: "in.jpg", path: "/w/in.jpg" }]);
  });
  it("ảnh khác nhau thì giữ đủ", () => {
    const jobs = [0, 1].map((id) => ({ id, image: `scene-${id}.jpg`, prompt: "p", file: `/w/scene-${id}.jpg` }));
    expect(datasetFiles(manifest, jobs)).toHaveLength(3);
  });
  it("manifest luôn đứng đầu", () => {
    expect(datasetFiles(manifest, [{ id: 0, image: "a.jpg", prompt: "p", file: "/w/a.jpg" }])[0]).toBe(manifest);
  });
});

describe("manifestJobs", () => {
  it("giữ tham số ghi đè của từng ô dò — mất chúng thì 6 ô chạy y hệt nhau, dò vô nghĩa", () => {
    const got = manifestJobs([{ id: 0, image: "in.jpg", prompt: "p", file: "/w/in.jpg", endStrength: 0.3, frames: 73, negative: "n" }]);
    expect(got[0]).toEqual({ id: 0, image: "in.jpg", prompt: "p", endStrength: 0.3, frames: 73, negative: "n" });
  });
  it("bỏ đường dẫn máy local (kernel không thấy được)", () => {
    expect(manifestJobs([{ id: 0, image: "in.jpg", prompt: "p", file: "/w/in.jpg" }])[0]).not.toHaveProperty("file");
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
    // Khóa khung cuối 0,3 — chốt bằng số đo của i2v-sweep; 0 thì model bỏ cảnh, 0,5 thì phí ~37% chuyển động.
    expect(m.endStrength).toBe(0.3);
    expect(m.endStrength).toBeGreaterThan(0);
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

describe("pickClipScenes — chương mở đầu tập", () => {
  it("40–44 clip, phần lớn trong 30 phút đầu", () => {
    const spans = planChapterScenes(2100, true);
    const got = pickClipScenes(spans, OPENER_CLIPS);
    expect(got.length).toBeGreaterThanOrEqual(40);
    expect(got.length).toBeLessThanOrEqual(44);
    expect(got.filter((i) => spans[i].zoom).length).toBeGreaterThanOrEqual(38);
  });
});

describe("đầu video động liền mạch (chương mở tập)", () => {
  it("số đoạn nối đủ phủ cảnh, tối đa 3", async () => {
    const { segmentsFor } = await import("./i2v-plan");
    expect(segmentsFor(3)).toBe(1); // 72 khung ≤ 97
    expect(segmentsFor(6)).toBe(2); // 144 khung: 97 + 96
    expect(segmentsFor(10)).toBe(3); // 240 khung: 97 + 96 + 96 = 289
    expect(segmentsFor(30)).toBe(3);
  });
  it("chọn cảnh liên tiếp từ đầu tới khi hết ngân sách đoạn, bỏ cảnh quá ngắn", async () => {
    const { pickContinuousScenes } = await import("./i2v-plan");
    const scenes = [
      { start: 0, end: 10 }, // 3 đoạn
      { start: 10, end: 11 }, // < 2 giây: bỏ qua
      { start: 11, end: 17 }, // 2 đoạn
      { start: 17, end: 27 }, // 3 đoạn → vượt ngân sách 6
      { start: 27, end: 30 },
    ];
    const r = pickContinuousScenes(scenes, 6);
    expect(r.picks).toEqual([0, 2]);
    expect([...r.segments.entries()]).toEqual([[0, 3], [2, 2]]);
  });
  it("manifest bật phóng nét cho production, tắt khi thăm dò model", async () => {
    const { buildManifest } = await import("./i2v-plan");
    expect(buildManifest([]).upscale).toBe(true);
    expect(buildManifest([], 42, { width: 720, height: 480, frames: 49, fps: 8 }).upscale).toBe(false);
  });
});
