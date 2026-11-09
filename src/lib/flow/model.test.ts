import { describe, expect, it } from "vitest";
import { buildFlow, formatSlot, formatTime, type FlowData, type NodeId } from "./model";

type VideoOverrides = Partial<FlowData["video"]>;

function data(v: VideoOverrides = {}): FlowData {
  return {
    video: {
      id: 31,
      status: "ready",
      error: null,
      runUrl: null,
      publishAt: null,
      durationSec: 1120,
      youtubeUrl: null,
      meta: { title: "Huyết Ma Điện", description: "mô tả", tags: ["ma tôn"], shortTitle: "Short", shortDescription: "mô tả short" },
      files: { "long.mp4": "/api/videos/31/long.mp4", "short.mp4": "/api/videos/31/short.mp4", "thumbnail.jpg": "/api/videos/31/thumbnail.jpg" },
      createdAt: "2026-11-09T07:00:00.000Z",
      updatedAt: "2026-11-09T07:30:00.000Z",
      ...v,
    },
    chapter: { id: 7, number: 12, title: "Huyết Ma Điện", words: 5840, opening: "Gió tanh…", approvedAt: "2026-11-09T07:00:00.000Z" },
    series: { id: 1, title: "Ma Tôn Truyện", bibleExcerpt: "bible", voiceStyle: "giọng nam trầm" },
    prevSummary: null,
  };
}

const RENDER: NodeId[] = ["agent", "tts", "images", "video"];

describe("buildFlow", () => {
  it("ready đủ file: nhóm render done, youtube chờ đăng theo lịch", () => {
    const { steps, notice } = buildFlow(data({ status: "ready", publishAt: "2026-11-12T12:00:00.000Z" }));
    expect(RENDER.map((k) => steps[k].state)).toEqual(["done", "done", "done", "done"]);
    expect(steps.youtube.state).toBe("wait");
    expect(steps.youtube.subtitle).toContain("19:00");
    expect(steps.video.subtitle).toBe("dài + Short");
    expect(steps.trigger).toMatchObject({ state: "done", subtitle: "Chương 12" });
    expect(notice).toBeNull();
  });

  it("ready không có lịch thì chờ đăng tay", () => {
    expect(buildFlow(data({ status: "ready", publishAt: null })).steps.youtube.subtitle).toBe("chờ đăng tay");
  });

  it("thiếu Short: video vẫn done nhưng có cảnh báo", () => {
    const s = buildFlow(data({ status: "ready", files: { "long.mp4": "/x" } })).steps;
    expect(s.video).toMatchObject({ state: "done", subtitle: "chỉ video dài", warning: "Không có Short" });
    expect(s.images.subtitle).toBe("xong");
  });

  it("failed với meta null không crash, youtube skip, notice đỏ", () => {
    const r = buildFlow(data({ status: "failed", meta: null, error: "ffmpeg chết", files: {} }));
    expect(RENDER.map((k) => r.steps[k].state)).toEqual(["error", "error", "error", "error"]);
    expect(r.steps.youtube).toMatchObject({ state: "skip", subtitle: "không đăng vì render lỗi" });
    expect(r.notice).toEqual({ tone: "error", text: "ffmpeg chết" });
  });

  it("queued vì hết quota là chờ, không phải lỗi", () => {
    const r = buildFlow(data({ status: "queued", error: "Hết quota ảnh Cloudflare hôm nay — chờ reset 7h sáng." }));
    expect(r.steps.images.state).toBe("wait");
    expect(r.notice).toEqual({ tone: "info", text: "Đang chờ: Hết quota ảnh Cloudflare hôm nay — chờ reset 7h sáng." });
  });

  it("queued không lỗi thì không có notice", () => {
    expect(buildFlow(data({ status: "queued" })).notice).toBeNull();
  });

  it("rendering: nhóm render run, trigger done", () => {
    const s = buildFlow(data({ status: "rendering" })).steps;
    expect(s.trigger.state).toBe("done");
    expect(s.tts).toMatchObject({ state: "run", subtitle: "đang render" });
    expect(s.youtube.state).toBe("wait");
  });

  it("published: youtube done", () => {
    expect(buildFlow(data({ status: "published" })).steps.youtube).toMatchObject({ state: "done", subtitle: "đã đăng" });
  });

  it("subtitle done theo dữ liệu có sẵn", () => {
    const s = buildFlow(data({ status: "ready" })).steps;
    expect(s.agent.subtitle).toBe("tiêu đề · Short · tag");
    expect(s.tts.subtitle).toBe("18:40");
    expect(s.images.subtitle).toBe("có thumbnail");
    const bare = buildFlow(data({ status: "ready", meta: null, durationSec: null })).steps;
    expect(bare.agent.subtitle).toBe("xong");
    expect(bare.tts.subtitle).toBe("xong");
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
