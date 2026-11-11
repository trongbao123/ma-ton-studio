// Phần thuần của parallax 2.5D: từ bản đồ độ sâu → mặt nạ 3 lớp (xa / giữa / gần) + ảnh vá hậu cảnh. Không I/O, không ffmpeg.
// Mọi mảng là ảnh vuông `size`×`size` (kích thước đầu ra của mô hình độ sâu); ffmpeg phóng lên khung 1080p sau.

/** Cạnh ảnh vào/ra của Depth Anything V2 (bội số 14, mô hình nhận vuông). */
export const DEPTH_SIZE = 518;

/** Ngưỡng tách lớp theo độ sâu đã chuẩn hoá 0 (xa) → 1 (gần): trên ngưỡng 1 là lớp giữa, trên ngưỡng 2 là lớp gần. */
export const LAYER_THRESHOLDS = [0.4, 0.68] as const;
/** Nửa bề rộng vùng chuyển mềm quanh ngưỡng (viền alpha mềm). */
const EDGE_SOFTNESS = 0.07;
/**
 * Bán kính (điểm ảnh ở 518²) nở vùng cần vá. Chỉ cần phủ viền mềm của vật: vùng lộ ra khi vật trượt đi luôn nằm TRONG dấu chân của vật,
 * nở quá tay thì ở khung đầu (mọi lớp thẳng hàng) miếng vá lộ ra quanh vật thành quầng mờ.
 */
const HOLE_GROW_RADIUS = 3;
const HOLE_GROW_GAIN = 2.5;
const PATCH_FEATHER_RADIUS = 2;
/** Miếng vá chỉ hiện ở nơi lớp trên gần như đặc (alpha 0,55 → 0,95): ở khung đầu mọi lớp thẳng hàng nên vá hiện ở chỗ lớp trên còn mờ sẽ làm vật bị "nhạt" / quầng. */
const PATCH_VISIBLE_FROM = 0.55;
const PATCH_VISIBLE_FULL = 0.95;
const MASK_SMOOTH_RADIUS = 2;
/** Bán kính các tầng làm mờ để vá lỗ: từ chi tiết → thô (vá nơi lỗ rộng). */
const FILL_RADII = [4, 14, 44] as const;
/** Trọng số tối thiểu của vùng đã biết để tin giá trị làm mờ chuẩn hoá. */
const MIN_FILL_WEIGHT = 0.02;
/** Phân vị cắt khi chuẩn hoá độ sâu (bỏ ngoại lai cực trị). */
const NORMALIZE_LOW = 0.02;
const NORMALIZE_HIGH = 0.98;

export type LayerMasks = {
  /** Độ phủ của lớp giữa (gồm cả vật ở lớp gần) và lớp gần, 0–255. */
  mid: Uint8Array;
  near: Uint8Array;
  /** Độ phủ của miếng vá hậu cảnh dán đè lên ảnh gốc để làm lớp xa (vùng giữa+gần bị che đi) / lớp giữa (vùng gần bị che đi). */
  farPatch: Uint8Array;
  midPatch: Uint8Array;
  /** Ảnh vá RGB (size²×3) của lớp xa và lớp giữa. */
  farFill: Uint8Array;
  midFill: Uint8Array;
};

/** Chuẩn hoá độ sâu về 0–1 theo phân vị 2%–98% (mô hình cho độ sâu tương đối, thang từng ảnh khác nhau). Ảnh phẳng → toàn 0,5. */
export function normalizeDepth(raw: ArrayLike<number>): Float32Array {
  const sample = Float32Array.from({ length: raw.length }, (_, i) => raw[i]).sort();
  const lo = sample[Math.floor((sample.length - 1) * NORMALIZE_LOW)];
  const hi = sample[Math.floor((sample.length - 1) * NORMALIZE_HIGH)];
  const out = new Float32Array(raw.length);
  const span = hi - lo;
  for (let i = 0; i < raw.length; i++) out[i] = span > 1e-6 ? Math.min(1, Math.max(0, (raw[i] - lo) / span)) : 0.5;
  return out;
}

/** Làm mờ hộp tách được theo từng trục (cộng dồn, O(n)), mép lấy giá trị cạnh gần nhất. */
export function boxBlur(src: Float32Array, size: number, radius: number, passes = 1): Float32Array {
  let cur = src;
  for (let p = 0; p < passes; p++) {
    cur = blurAxis(blurAxis(cur, size, radius, true), size, radius, false);
  }
  return cur;
}

function blurAxis(src: Float32Array, size: number, radius: number, horizontal: boolean): Float32Array {
  const out = new Float32Array(src.length);
  const stride = horizontal ? 1 : size;
  const lineStride = horizontal ? size : 1;
  const norm = 1 / (2 * radius + 1);
  for (let line = 0; line < size; line++) {
    const base = line * lineStride;
    const at = (k: number) => src[base + Math.min(size - 1, Math.max(0, k)) * stride];
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += at(k);
    for (let k = 0; k < size; k++) {
      out[base + k * stride] = sum * norm;
      sum += at(k + radius + 1) - at(k - radius);
    }
  }
  return out;
}

const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Mặt nạ mềm "sâu hơn ngưỡng" (1 = thuộc lớp gần hơn ngưỡng). */
function softMask(depth: Float32Array, threshold: number): Float32Array {
  return depth.map((d) => smoothstep(threshold - EDGE_SOFTNESS, threshold + EDGE_SOFTNESS, d));
}

/** Nở vùng mặt nạ ra `radius` điểm (làm mờ rồi nâng ngưỡng) — đủ phủ vùng ma của vật khi nó trượt đi. */
function grow(mask: Float32Array, size: number, radius: number): Float32Array {
  const blurred = boxBlur(mask, size, radius, 2);
  return blurred.map((v) => Math.min(1, v * HOLE_GROW_GAIN));
}

/**
 * Vá lỗ bằng làm mờ chuẩn hoá nhiều tầng: ở điểm lỗ lấy trung bình có trọng số của vùng đã biết xung quanh,
 * tầng nhỏ nhất đủ dữ liệu thắng. `hole` 0–1 (1 = phải vá). Trả RGB `Uint8Array` size²×3.
 */
export function inpaintBlur(rgb: Uint8Array, hole: Float32Array, size: number): Uint8Array {
  const n = size * size;
  const known = hole.map((h) => 1 - h);
  const channels = [0, 1, 2].map((c) => Float32Array.from({ length: n }, (_, i) => rgb[i * 3 + c] * known[i]));
  const levels = FILL_RADII.map((r) => ({ weight: boxBlur(known, size, r, 2), color: channels.map((ch) => boxBlur(ch, size, r, 2)) }));
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const level = levels.find((l) => l.weight[i] > MIN_FILL_WEIGHT) ?? levels[levels.length - 1];
    const w = Math.max(level.weight[i], 1e-6);
    for (let c = 0; c < 3; c++) {
      const filled = level.color[c][i] / w;
      out[i * 3 + c] = Math.round(known[i] * rgb[i * 3 + c] + hole[i] * filled);
    }
  }
  return out;
}

const toByte = (a: Float32Array) => Uint8Array.from(a, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255));

/** Từ độ sâu thô + ảnh RGB (size²×3, cùng khung cắt) → các mặt nạ và ảnh vá cho 3 lớp. */
export function buildLayerMasks(rawDepth: ArrayLike<number>, rgb: Uint8Array, size = DEPTH_SIZE): LayerMasks {
  const depth = boxBlur(normalizeDepth(rawDepth), size, MASK_SMOOTH_RADIUS, 1);
  const mid = softMask(depth, LAYER_THRESHOLDS[0]);
  const near = softMask(depth, LAYER_THRESHOLDS[1]);
  const farHole = grow(mid, size, HOLE_GROW_RADIUS);
  const midHole = grow(near, size, HOLE_GROW_RADIUS);
  const patchAlpha = (m: Float32Array) => boxBlur(m.map((v) => smoothstep(PATCH_VISIBLE_FROM, PATCH_VISIBLE_FULL, v)), size, PATCH_FEATHER_RADIUS, 1);
  return {
    mid: toByte(mid),
    near: toByte(near),
    farPatch: toByte(patchAlpha(mid)),
    midPatch: toByte(patchAlpha(near)),
    farFill: inpaintBlur(rgb, farHole, size),
    midFill: inpaintBlur(rgb, midHole, size),
  };
}

/** Ảnh xám 8 bit → PGM nhị phân (ffmpeg đọc thẳng). */
export function toPgm(gray: Uint8Array, size: number): Buffer {
  return Buffer.concat([Buffer.from(`P5\n${size} ${size}\n255\n`), gray]);
}

/** Ảnh RGB 8 bit → PPM nhị phân. */
export function toPpm(rgb: Uint8Array, size: number): Buffer {
  return Buffer.concat([Buffer.from(`P6\n${size} ${size}\n255\n`), rgb]);
}

/** Đọc lại PGM do `toPgm` ghi (cache độ sâu cạnh ảnh); sai định dạng thì null. */
export function parsePgm(buf: Buffer, size: number): Uint8Array | null {
  const header = Buffer.from(`P5\n${size} ${size}\n255\n`);
  if (buf.length !== header.length + size * size || !buf.subarray(0, header.length).equals(header)) return null;
  return new Uint8Array(buf.subarray(header.length));
}
