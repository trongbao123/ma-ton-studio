import type { NodeId, StepState } from "./model";

/** Tiến độ pipeline ghi vào `videos.progress` — dùng chung cho pipeline (ghi) và màn flow (đọc). */
export type Part = { done: number; total: number };
export type StepProgress = {
  state: StepState;
  startedAt?: string;
  finishedAt?: string;
  long?: Part;
  short?: Part;
  model?: string;
  error?: string;
  /** Short lỗi/bỏ qua — chỉ cảnh báo, bước vẫn xong. */
  warning?: string;
  log: { at: string; text: string }[];
};
export type Scene = { i: number; start: number; end: number; text: string; prompt: string; action: boolean; file?: string };
/** Giai đoạn của bước clip động (Kaggle) — màn flow hiện chữ tương ứng. */
export type I2vStage = "upload" | "queued" | "running" | "download" | "done";
/** Một clip động: ảnh gốc (cảnh `scene`, file `long-img-N.jpg`), prompt chuyển động, thời gian GPU, file mp4 khi đã có. */
export type I2vClip = { scene: number; motion: string; seconds?: number; file?: string; ok?: boolean };
export type I2vProgress = { stage?: I2vStage; model?: string; gpu?: string; gpuMinutes?: number; kernelUrl?: string; clips: I2vClip[] };

const I2V_STAGE_TEXT: Record<I2vStage, string> = {
  upload: "đang đẩy lên Kaggle",
  queued: "chờ GPU Kaggle",
  running: "đang chạy trên GPU",
  download: "đang tải clip về",
  done: "xong",
};

/** Dòng trạng thái ngắn của thẻ Clip động: "đang chạy trên GPU (2/6 clip)". */
export function i2vSubtitle(state: StepState, stage: I2vStage | undefined, done: number, total: number): string {
  if (state === "error") return "lỗi → dùng ảnh tĩnh";
  if (state === "skip") return "bỏ qua";
  if (state === "wait") return "chờ";
  if (state === "done") return total ? `xong (${done}/${total} clip)` : "xong";
  const text = I2V_STAGE_TEXT[stage ?? "upload"];
  return total && stage === "running" ? `${text} (${done}/${total} clip)` : text;
}

/** Kernel Kaggle đang tạo clip cho thanh trên cùng: "x/y clip" + giai đoạn; không chạy thì null. */
export type KaggleNow = { done: number; total: number; stage: I2vStage };

export function kaggleNow(p: VideoProgress | null | undefined): KaggleNow | null {
  const step = p?.steps.i2v;
  if (step?.state !== "run") return null;
  const clips = p?.i2v?.clips ?? [];
  return { done: clips.filter((c) => c.ok).length, total: step.long?.total ?? clips.length, stage: p?.i2v?.stage ?? "upload" };
}

export type VideoProgress = {
  steps: Partial<Record<NodeId, StepProgress>>;
  scenes?: { long: Scene[]; short: Scene[] };
  /** Prompt đã gửi AI (cắt ngắn) để xem lại trong inspector. */
  prompts?: { meta?: string; scenes?: string };
  /** Clip động (Kaggle) của video chương nội bộ. */
  i2v?: I2vProgress;
};

export const LOG_KEEP = 30;
