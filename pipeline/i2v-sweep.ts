// Dò tham số clip động ("làm như phim"): phần THUẦN — dựng các ô thử + lệnh đo, không gọi mạng.
// Lý do có file này: LTX 2B hoặc đứng yên (khóa cứng 2 đầu) hoặc méo mặt (không khóa), nên phải thử nhiều mức
// TRONG MỘT lượt Kaggle rồi đo bằng số, thay vì đổi mặc định rồi đoán. Lượt chạy nằm ở i2v.ts (`i2v-sweep`).
import { CLIP_FRAMES, CLIP_HEIGHT, CLIP_WIDTH, MOTION_NEGATIVE, MOTION_SUFFIX } from "./i2v-plan";
import { STILL_FPS } from "./still";

/** Cách ra lệnh cho model: `effects` = như production hiện tại (chỉ hiệu ứng quanh nhân vật); `action` = cho phép hành động nhỏ có thật trong cảnh. */
export type SweepStyle = "effects" | "action";

export const SWEEP_STYLES: Record<SweepStyle, { suffix: string; negative: string }> = {
  effects: { suffix: MOTION_SUFFIX, negative: MOTION_NEGATIVE },
  action: {
    // Bỏ "changing pose" khỏi negative, giữ "deformed face"/"camera movement".
    // ĐÃ ĐO (i2v-sweep, LTX 2B): KHÔNG ăn thua — ở cùng mức khóa, `action` cho ÍT chuyển động hơn `effects`
    // (2,06 vs 2,75 ở khóa 0,3; 1,55 vs 2,01 ở khóa 0,5) và ở khóa 0 thì trôi mạnh hơn hẳn (SSIM 0,566 vs 0,599).
    // Giữ lại để đo tiếp khi đổi model lớn hơn — với 2B thì prompt không phải nút thắt.
    suffix:
      "the character performs ONE small natural action from the scene — turns his head, lifts an arm, takes a single step, or swings his weapon once — " +
      "with epic xianxia visual effects around him, static camera, the character keeps the same face, hair and outfit, same 3D donghua art style",
    negative: `${MOTION_NEGATIVE.split(", ").filter((t) => t !== "changing pose").join(", ")}, extra limbs, detached limbs, warping body, melting hands`,
  },
};

/**
 * Ứng viên model để thăm dò trên T4 (16 GB, Turing — KHÔNG có bf16 và KHÔNG có fp8 phần cứng,
 * nên mọi ứng viên phải chạy được fp16; bản fp8 của LTX 13B vì thế bị loại thẳng).
 * `family` quyết định run.py dùng pipeline nào. Chạy bằng CLI `i2v-model` để lấy VRAM đỉnh + giây/clip trước khi tích hợp.
 */
export type ModelProbe = {
  /** Tên in ra log kernel; run.py đọc spec["name"] kể cả ở nhánh lỗi nên KHÔNG được thiếu. */
  name: string;
  family: "ltx" | "cogvideox";
  repo: string;
  file?: string;
  dtype: "float16";
  steps: number;
  guidance: number;
  timesteps?: number[];
  width: number;
  height: number;
  frames: number;
  fps: number;
  /** Ghi chú rủi ro đã biết, in ra cùng kết quả. */
  note?: string;
};

export const MODEL_PROBES: Record<string, ModelProbe> = {
  // Mốc so sánh: đúng model đang chạy production.
  ltx2b: {
    name: "LTX-Video 0.9.8 2B distilled", family: "ltx", repo: "Lightricks/LTX-Video", file: "ltxv-2b-0.9.8-distilled.safetensors", dtype: "float16",
    steps: 8, guidance: 1.0, timesteps: [1000, 993, 987, 981, 975, 909, 725, 0.03],
    width: CLIP_WIDTH, height: CLIP_HEIGHT, frames: CLIP_FRAMES, fps: STILL_FPS,
  },
  // 6B, nổi tiếng động người hơn LTX 2B. Kích thước CỐ ĐỊNH 720×480, 49 khung @ 8 fps (ghép vào pipeline phải đổi fps).
  // Rủi ro thật: model huấn luyện bf16, T4 chỉ có fp16 → dễ ra NaN/khung đen; `usable()` trong run.py sẽ bắt được.
  cogvideox5b: {
    name: "CogVideoX-5B I2V", family: "cogvideox", repo: "zai-org/CogVideoX-5b-I2V", dtype: "float16",
    steps: 50, guidance: 6, width: 720, height: 480, frames: 49, fps: 8,
    note: "train bf16, chạy fp16 trên T4 có thể NaN; cần sequential cpu offload + vae tiling/slicing",
  },
};

export type SweepCell = { id: number; style: SweepStyle; endStrength: number; frames: number; prompt: string; negative: string };

/**
 * Một ô thử cho mỗi tổ hợp (kiểu prompt × độ khóa khung cuối × số khung). Dùng CÙNG một ảnh và cùng câu chuyển động
 * để chênh lệch đo được chỉ do tham số. 2 kiểu × 3 mức khóa ≈ 6 clip ≈ 5 phút GPU + nạp model.
 */
export function sweepCells(o: { motion: string; endStrengths: number[]; styles: SweepStyle[]; frames?: number[] }): SweepCell[] {
  const frames = o.frames ?? [CLIP_FRAMES];
  const cells: SweepCell[] = [];
  for (const style of o.styles) {
    for (const endStrength of o.endStrengths) {
      for (const n of frames) {
        const { suffix, negative } = SWEEP_STYLES[style];
        cells.push({ id: cells.length, style, endStrength, frames: n, negative, prompt: `${o.motion.trim().replace(/[.\s]+$/, "")}, ${suffix}` });
      }
    }
  }
  return cells;
}

/** Đo chuyển động: in YDIF (chênh lệch độ sáng giữa 2 khung liền nhau) của từng khung. Đứng yên ≈ 0,1; có chuyển động thật ≈ 2–3+. */
export function ydifArgs(clip: string): string[] {
  return ["-i", clip, "-vf", "signalstats,metadata=print:key=lavfi.signalstats.YDIF", "-f", "null", "-"];
}

/** YDIF trung bình của cả clip; không đọc được thì null (KHÔNG trả 0 — 0 nghĩa là clip đứng yên, khác hẳn "không đo được"). */
export function meanYdif(log: string): number | null {
  const all = [...log.matchAll(/lavfi\.signalstats\.YDIF=([\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
}

/** Đo trôi hình: SSIM giữa 2 ảnh (khung cuối clip so với ảnh gốc). Càng thấp càng trôi xa ảnh gốc — mặt dễ méo. */
export function ssimArgs(a: string, b: string): string[] {
  return ["-i", a, "-i", b, "-lavfi", "ssim", "-f", "null", "-"];
}

export function parseSsim(log: string): number | null {
  const last = [...log.matchAll(/All:([\d.]+)/g)].at(-1);
  return last ? Number(last[1]) : null;
}

export type SweepRow = { cell: SweepCell; ok: boolean; seconds: number; ydif: number | null; ssim: number | null };

/** Bảng kết quả để đọc bằng mắt: ô nào vừa động (YDIF cao) vừa giữ hình (SSIM cao) là ô nên lấy làm mặc định. */
export function sweepTable(rows: SweepRow[]): string {
  const num = (x: number | null, digits: number) => (x == null ? "    —" : x.toFixed(digits).padStart(5));
  const head = ["#", "kiểu   ", "khóa", "khung", "YDIF ", "SSIM ", "GPU"].join("  ");
  return [
    head,
    ...rows.map((r) =>
      [
        String(r.cell.id).padStart(1),
        r.cell.style.padEnd(7),
        r.cell.endStrength.toFixed(2).padStart(4),
        String(r.cell.frames).padStart(5),
        r.ok ? num(r.ydif, 2) : " LỖI",
        r.ok ? num(r.ssim, 3) : " LỖI",
        `${r.seconds}s`,
      ].join("  "),
    ),
  ].join("\n");
}
