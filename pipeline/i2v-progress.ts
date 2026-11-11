// Tiến độ TRỰC TIẾP của kernel Kaggle: phần THUẦN (gộp sự kiện, không đụng DB/mạng).
//
// Vì sao cần: API Kaggle chỉ trả log SAU KHI kernel xong (`kernels/output` rỗng lúc đang chạy), nên cả màn flow
// lẫn CLI đều mù suốt lượt chạy — với model chậm thì đó là cả tiếng đồng hồ không biết đang ở đâu.
// Kernel bật internet nên tự POST tiến độ về `/api/i2v/progress`; file này lo phần kiểm tra + gộp.
//
// Dữ liệu đến từ BÊN NGOÀI (kernel chạy trên máy Kaggle) nên coi là không tin được: mọi số đều phải kẹp,
// slug phải đúng dạng, và sự kiện của phiên khác bị bỏ để 2 kernel không trộn vào nhau.

/** Số dòng log giữ lại cho mỗi phiên. */
export const PROGRESS_KEEP = 30;

/** Dạng slug kernel do kaggleSlug() sinh ra — chặn cả path traversal khi dùng làm khoá app_settings. */
const SLUG_RE = /^mts-i2v-(?:run|data)-\d{1,9}-[a-z0-9]{1,16}$/;

const STAGES = ["load", "clip", "done", "error"] as const;
export type ProgressStage = (typeof STAGES)[number];

export type I2vProgressEvent = {
  slug: string;
  videoId: number;
  total: number;
  stage: ProgressStage;
  clip?: number;
  step?: number;
  steps?: number;
  seconds?: number;
  vram?: number;
  message?: string;
};

export type I2vProgressState = {
  slug: string;
  videoId: number;
  total: number;
  stage: ProgressStage | null;
  clips: Record<number, { step?: number; steps?: number; seconds?: number; done?: boolean }>;
  vramPeak: number | null;
  log: string[];
  updatedAt: string;
};

export const progressKey = (slug: string) => `i2v:progress:${slug}`;

export function emptyProgress(slug: string, videoId: number, total: number): I2vProgressState {
  return { slug, videoId, total, stage: null, clips: {}, vramPeak: null, log: [], updatedAt: new Date(0).toISOString() };
}

/** Số nguyên trong khoảng, không thì undefined; `strict` = có mặt nhưng sai thì vứt cả sự kiện. */
function int(v: unknown, max: number): number | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > max) return null;
  return v;
}

function num(v: unknown, max: number): number | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) return null;
  return v;
}

/** Kiểm tra sự kiện kernel gửi lên. Sai bất cứ chỗ nào → null (bỏ hẳn, không đoán ý). */
export function parseProgressEvent(raw: unknown): I2vProgressEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.slug !== "string" || !SLUG_RE.test(r.slug)) return null;
  if (typeof r.stage !== "string" || !(STAGES as readonly string[]).includes(r.stage)) return null;
  const videoId = int(r.videoId, 10 ** 9);
  const total = int(r.total, 1000);
  const clip = int(r.clip, 1000);
  const step = int(r.step, 10_000);
  const steps = int(r.steps, 10_000);
  const seconds = num(r.seconds, 86_400);
  const vram = num(r.vram, 1024);
  if ([videoId, total, clip, step, steps, seconds, vram].some((x) => x === null)) return null;
  // Qua được dòng trên thì không còn null nào — TS chưa suy ra được nên nói rõ.
  const ok = { videoId, total, clip, step, steps, seconds, vram } as {
    videoId?: number; total?: number; clip?: number; step?: number; steps?: number; seconds?: number; vram?: number;
  };
  return {
    slug: r.slug,
    videoId: ok.videoId ?? 0,
    total: ok.total ?? 0,
    stage: r.stage as ProgressStage,
    ...(ok.clip !== undefined ? { clip: ok.clip } : {}),
    ...(ok.step !== undefined ? { step: ok.step } : {}),
    ...(ok.steps !== undefined ? { steps: ok.steps } : {}),
    ...(ok.seconds !== undefined ? { seconds: ok.seconds } : {}),
    ...(ok.vram !== undefined ? { vram: ok.vram } : {}),
    ...(typeof r.message === "string" ? { message: r.message.slice(0, 300) } : {}),
  };
}

/** Gộp một sự kiện vào trạng thái. Sự kiện của phiên khác bị bỏ nguyên vẹn. */
export function mergeProgress(prev: I2vProgressState | null, ev: I2vProgressEvent): I2vProgressState {
  const base = prev ?? emptyProgress(ev.slug, ev.videoId, ev.total);
  if (ev.slug !== base.slug) return base;
  const clips = { ...base.clips };
  if (ev.clip !== undefined) {
    const cur = clips[ev.clip] ?? {};
    clips[ev.clip] = {
      ...cur,
      ...(ev.step !== undefined ? { step: ev.step } : {}),
      ...(ev.steps !== undefined ? { steps: ev.steps } : {}),
      ...(ev.seconds !== undefined ? { seconds: ev.seconds } : {}),
      ...(ev.stage === "done" ? { done: true } : {}),
    };
  }
  return {
    ...base,
    total: ev.total || base.total,
    stage: ev.stage,
    clips,
    // Giữ đỉnh CAO NHẤT từng thấy: số sau thấp hơn không được xoá kỷ lục (VRAM tụt sau khi giải phóng là bình thường).
    vramPeak: ev.vram !== undefined ? Math.max(base.vramPeak ?? 0, ev.vram) : base.vramPeak,
    log: ev.message ? [...base.log, ev.message].slice(-PROGRESS_KEEP) : base.log,
    updatedAt: new Date().toISOString(),
  };
}

/** Một dòng đọc được bằng mắt cho CLI và màn flow. */
export function progressLine(s: I2vProgressState): string {
  const done = Object.values(s.clips).filter((c) => c.done).length;
  const running = Object.entries(s.clips).find(([, c]) => !c.done && c.step !== undefined);
  const parts = [`clip ${done}/${s.total || Object.keys(s.clips).length || "?"}`];
  if (running) {
    const c = running[1];
    parts.push(`bước ${c.step}/${c.steps ?? "?"}`);
  }
  if (s.vramPeak != null) parts.push(`VRAM ${s.vramPeak.toFixed(1)}GiB`);
  if (!running && !done && s.stage === null) return "chưa có tín hiệu từ kernel";
  if (s.stage === "load") parts.push("đang nạp model");
  return parts.join(" · ");
}
