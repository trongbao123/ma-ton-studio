import type { Video, VideoMeta } from "@/db/schema";
import type { StepProgress, VideoProgress } from "./progress";

export type FileName = "long.mp4" | "short.mp4" | "thumbnail.jpg" | "youtube.txt";
export type NodeId = "trigger" | "agent" | "tts" | "images" | "video" | "youtube";
export type StepState = "wait" | "run" | "done" | "error" | "skip";
export type StepView = { id: NodeId; title: string; subtitle: string; state: StepState; warning?: string; /** 0–1 khi đang chạy có đếm */ progress?: number };
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
    /** Tên asset → URL tải. Ngoài các file chính còn ảnh cảnh ("long-img-3.jpg") và giọng đọc ("narration.m4a"). */
    files: Partial<Record<FileName, string>> & Record<string, string>;
    createdAt: string;
    updatedAt: string;
    progress: VideoProgress;
    uploadStatus: Video["uploadStatus"];
    uploadError: string | null;
    youtubeVideoId: string | null;
    youtubeShortId: string | null;
  };
  chapter: { id: number; number: number; title: string; words: number; opening: string; approvedAt: string };
  series: { id: number; title: string; bibleExcerpt: string; voiceStyle: string; ttsVoice: string; makeShort: boolean; autoPublish: boolean };
  prevSummary: string | null;
  youtube: { connected: boolean; channel: string | null };
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

const RENDER_STEPS = ["agent", "tts", "images", "video"] as const;

/**
 * Video kẹt "đang render" (job bị huỷ/hết giờ giữa chừng): pipeline mới ghi tiến độ ~2s/lần nên 30 phút im lặng là kẹt;
 * video chạy bằng pipeline cũ (không có tiến độ) thì chờ 4 giờ — bằng giới hạn job daily.
 */
export function isStale(v: FlowData["video"], now = Date.now()) {
  if (v.status !== "rendering") return false;
  const quiet = now - Date.parse(v.updatedAt);
  return quiet > (Object.keys(v.progress?.steps ?? {}).length ? 30 : 240) * 60_000;
}

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Giờ Việt Nam (UTC+7, không đổi giờ). Tự định dạng vì ICU của Node và trình duyệt ra chữ khác nhau → lỗi hydration. */
function vn(iso: string) {
  const d = new Date(Date.parse(iso) + 7 * 3600_000);
  return {
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    dm: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`,
    wd: WEEKDAYS[d.getUTCDay()],
  };
}

/** "19:00 · T5 12/11" */
export function formatSlot(iso: string) {
  const t = vn(iso);
  return `${t.hm} · ${t.wd} ${t.dm}`;
}

/** "14:32 09/11" */
export function formatTime(iso: string) {
  const t = vn(iso);
  return `${t.hm} ${t.dm}`;
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

/** "Dài 18/30 · Short 3/5" khi pipeline có đếm tiến độ. */
function progressSubtitle(p: StepProgress) {
  const parts = [p.long && `Dài ${p.long.done}/${p.long.total}`, p.short && `Short ${p.short.done}/${p.short.total}`].filter(Boolean);
  if (p.state === "error" && p.error) return "lỗi";
  return parts.length ? parts.join(" · ") : undefined;
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

  // Có tiến độ thật từ pipeline thì dùng thay cho trạng thái suy ra.
  const tracked = v.progress?.steps ?? {};
  const hasProgress = Object.keys(tracked).length > 0;
  for (const id of RENDER_STEPS) {
    const p = tracked[id];
    if (p) {
      steps[id] = step(id, p.state, progressSubtitle(p) ?? steps[id].subtitle, p.warning ?? steps[id].warning);
      const parts = [p.long, p.short].filter((x) => x && x.total > 0) as { done: number; total: number }[];
      if (p.state === "run" && parts.length) steps[id].progress = parts.reduce((a, x) => a + x.done, 0) / parts.reduce((a, x) => a + x.total, 0);
    }
    // Bước chưa tới lượt: chờ, hoặc bỏ qua nếu render đã lỗi ở bước trước.
    else if (hasProgress && !finished) steps[id] = step(id, v.status === "failed" ? "skip" : "wait", "chưa chạy");
  }

  if (v.uploadStatus === "uploading") steps.youtube = step("youtube", "run", "đang upload");
  else if (v.uploadStatus === "scheduled")
    steps.youtube = step("youtube", "done", v.publishAt ? `đã lên lịch · ${formatSlot(v.publishAt)}` : "đã lên lịch");
  else if (v.uploadStatus === "failed") steps.youtube = step("youtube", "error", "upload lỗi", v.uploadError ?? undefined);
  else if (v.status === "published") steps.youtube = step("youtube", "done", "đã đăng");
  else if (v.status === "failed") steps.youtube = step("youtube", "skip", "không đăng vì render lỗi");
  else if (v.status === "ready") steps.youtube = step("youtube", "wait", v.publishAt ? `chờ đăng · ${formatSlot(v.publishAt)}` : "chờ đăng tay");
  else steps.youtube = step("youtube", "wait", "chờ render xong");

  if (v.status === "failed") notice = { tone: "error", text: v.error ?? "Render lỗi" };
  else if (v.status === "queued" && v.error) notice = { tone: "info", text: `Đang chờ: ${v.error}` };

  return { steps, notice };
}
