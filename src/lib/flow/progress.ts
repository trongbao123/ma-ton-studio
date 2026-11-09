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
export type VideoProgress = {
  steps: Partial<Record<NodeId, StepProgress>>;
  scenes?: { long: Scene[]; short: Scene[] };
  /** Prompt đã gửi AI (cắt ngắn) để xem lại trong inspector. */
  prompts?: { meta?: string; scenes?: string };
};

export const LOG_KEEP = 30;
