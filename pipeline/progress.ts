import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import type { NodeId } from "@/lib/flow/model";
import { LOG_KEEP, type StepProgress, type VideoProgress } from "@/lib/flow/progress";

const FLUSH_MS = 2000;

/**
 * Ghi tiến độ render vào `videos.progress` cho màn flow xem gần như realtime.
 * Ghi thưa (≤ 1 lần / 2s, đổi trạng thái thì ghi ngay) và nối tiếp nhau; lỗi DB chỉ cảnh báo, không làm hỏng render.
 */
export class Tracker {
  private p: VideoProgress = { steps: {} };
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly videoId: number) {}

  private step(id: NodeId): StepProgress {
    return (this.p.steps[id] ??= { state: "wait", log: [] });
  }

  start(id: NodeId, part: { long?: number; short?: number } = {}) {
    const s = this.step(id);
    s.state = "run";
    s.startedAt ??= new Date().toISOString();
    if (part.long != null) s.long = { done: 0, total: part.long };
    if (part.short != null) s.short = { done: 0, total: part.short };
    this.log(id, "Bắt đầu");
    void this.flush();
  }

  total(id: NodeId, which: "long" | "short", total: number) {
    const s = this.step(id);
    s[which] = { done: s[which]?.done ?? 0, total };
    this.schedule();
  }

  tick(id: NodeId, which: "long" | "short", text?: string) {
    const part = this.step(id)[which];
    if (part) part.done = Math.min(part.done + 1, part.total);
    if (text) this.log(id, text);
    else this.schedule();
  }

  log(id: NodeId, text: string) {
    const s = this.step(id);
    s.log = [...s.log, { at: new Date().toISOString(), text }].slice(-LOG_KEEP);
    this.schedule();
  }

  model(id: NodeId, model: string | undefined) {
    if (model) this.step(id).model = model;
    this.schedule();
  }

  warn(id: NodeId, text: string) {
    this.step(id).warning = text;
    this.log(id, `⚠ ${text}`);
  }

  set(patch: Partial<Omit<VideoProgress, "steps">>) {
    Object.assign(this.p, patch);
    this.schedule();
  }

  /** Gắn file ảnh đã upload cho một cảnh để màn flow hiện ảnh ngay. */
  sceneFile(which: "long" | "short", i: number, file: string) {
    const sc = this.p.scenes?.[which]?.[i];
    if (sc) sc.file = file;
    this.schedule();
  }

  finish(id: NodeId, state: "done" | "error" | "skip" = "done", error?: string) {
    const s = this.step(id);
    s.state = state;
    s.finishedAt = new Date().toISOString();
    if (error) s.error = error;
    this.log(id, state === "done" ? "Xong" : state === "skip" ? "Bỏ qua" : `Lỗi: ${error ?? ""}`);
    void this.flush();
  }

  /** Lỗi giữa chừng: mọi bước đang chạy chuyển lỗi. */
  fail(error: string) {
    for (const id of Object.keys(this.p.steps) as NodeId[]) if (this.p.steps[id]!.state === "run") this.finish(id, "error", error.slice(0, 500));
    return this.flush();
  }

  /** Hết quota: giữ trạng thái chạy, ghi chú chờ lượt sau. */
  pause(reason: string) {
    for (const id of Object.keys(this.p.steps) as NodeId[]) if (this.p.steps[id]!.state === "run") this.log(id, `⏸ ${reason}`);
    return this.flush();
  }

  private schedule() {
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const snapshot = structuredClone(this.p);
    this.writing = this.writing
      .then(() => db().update(videos).set({ progress: snapshot }).where(eq(videos.id, this.videoId)))
      .then(() => undefined)
      .catch((e) => console.warn("⚠ Không ghi được tiến độ:", e instanceof Error ? e.message : e));
    return this.writing;
  }
}
