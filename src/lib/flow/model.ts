import type { Video, VideoMeta } from "@/db/schema";

export type FileName = "long.mp4" | "short.mp4" | "thumbnail.jpg" | "youtube.txt";
export type NodeId = "trigger" | "agent" | "tts" | "images" | "video" | "youtube";
export type StepState = "wait" | "run" | "done" | "error" | "skip";
export type StepView = { id: NodeId; title: string; subtitle: string; state: StepState; warning?: string };
export type FlowNotice = { tone: "info" | "error"; text: string } | null;

/** Dữ liệu màn flow — ngày giờ là chuỗi ISO để truyền được từ server sang client. */
export type FlowData = {
  video: {
    id: number;
    status: Video["status"];
    error: string | null;
    runUrl: string | null;
    publishAt: string | null;
    durationSec: number | null;
    youtubeUrl: string | null;
    meta: VideoMeta | null;
    files: Partial<Record<FileName, string>>;
    createdAt: string;
    updatedAt: string;
  };
  chapter: { id: number; number: number; title: string; words: number; opening: string; approvedAt: string };
  series: { id: number; title: string; bibleExcerpt: string; voiceStyle: string };
  prevSummary: string | null;
};

export const TITLES: Record<NodeId, string> = {
  trigger: "Chương đã duyệt",
  agent: "AI Agent",
  tts: "Giọng đọc",
  images: "Vẽ ảnh cảnh",
  video: "Dựng video",
  youtube: "Đăng YouTube",
};

export const STATUS_LABEL: Record<Video["status"], [string, string]> = {
  queued: ["Chờ render", "bg-zinc-700/60 text-zinc-200"],
  rendering: ["Đang render…", "bg-sky-900/70 text-sky-300"],
  ready: ["Sẵn sàng đăng", "bg-emerald-900/70 text-emerald-300"],
  failed: ["Lỗi", "bg-red-900/70 text-red-300"],
  published: ["Đã đăng", "bg-zinc-800 text-zinc-400"],
};

const RENDER_STEPS =["agent", "tts", "images", "video"] as const;

export function formatSlot(iso: string) {
  return new Date(iso).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clock(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

/** Subtitle khi bước render đã xong — chỉ dựa vào dữ liệu thật đang có. */
function doneSubtitle(id: (typeof RENDER_STEPS)[number], v: FlowData["video"]) {
  switch (id) {
    case "agent":
      return v.meta ? "tiêu đề · Short · tag" : "xong";
    case "tts":
      return v.durationSec ? clock(v.durationSec) : "xong";
    case "images":
      return v.files["thumbnail.jpg"] ? "có thumbnail" : "xong";
    case "video":
      return v.files["short.mp4"] ? "dài + Short" : "chỉ video dài";
  }
}

/**
 * Suy trạng thái từng node từ trạng thái chung của video. Chưa có tiến độ từng bước
 * nên cả nhóm render cùng một trạng thái — bản cập nhật pipeline sẽ thay bằng dữ liệu thật.
 */
export function buildFlow(d: FlowData): { steps: Record<NodeId, StepView>; notice: FlowNotice } {
  const v = d.video;
  const step = (id: NodeId, state: StepState, subtitle: string, warning?: string): StepView => ({
    id, title: TITLES[id], state, subtitle, ...(warning ? { warning } : {}),
  });
  const steps = { trigger: step("trigger", "done", `Chương ${d.chapter.number}`) } as Record<NodeId, StepView>;
  let notice: FlowNotice = null;
  const finished = v.status === "ready" || v.status === "published";

  for (const id of RENDER_STEPS) {
    if (finished) {
      const warn = id === "video" && !v.files["short.mp4"] ? "Không có Short" : undefined;
      steps[id] = step(id, "done", doneSubtitle(id, v), warn);
    } else if (v.status === "rendering") steps[id] = step(id, "run", "đang render");
    else if (v.status === "failed") steps[id] = step(id, "error", "lỗi render");
    else steps[id] = step(id, "wait", "chờ");
  }

  if (v.status === "published") steps.youtube = step("youtube", "done", "đã đăng");
  else if (v.status === "failed") steps.youtube = step("youtube", "skip", "không đăng vì render lỗi");
  else if (v.status === "ready") steps.youtube = step("youtube", "wait", v.publishAt ? `chờ đăng · ${formatSlot(v.publishAt)}` : "chờ đăng tay");
  else steps.youtube = step("youtube", "wait", "chờ render xong");

  if (v.status === "failed") notice = { tone: "error", text: v.error ?? "Render lỗi" };
  else if (v.status === "queued" && v.error) notice = { tone: "info", text: `Đang chờ: ${v.error}` };

  return { steps, notice };
}
