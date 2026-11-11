// Phần thuần của parallax 2.5D: lịch chuyển động máy quay, dựng đồ thị filter ffmpeg, chọn ảnh nào được áp theo ngân sách.
// Không I/O. Mô hình độ sâu / ffmpeg nằm ở parallax.ts.

export type ParallaxMotion = "dollyIn" | "truckRight" | "craneUp" | "truckLeft";
/** Vòng xoay giữa các ảnh: đẩy vào → trượt phải → nâng lên → trượt trái (ảnh đầu luôn là dolly-in). */
export const PARALLAX_MOTIONS: readonly ParallaxMotion[] = ["dollyIn", "truckRight", "craneUp", "truckLeft"];

export const parallaxMotionFor = (index: number): ParallaxMotion => PARALLAX_MOTIONS[((index % PARALLAX_MOTIONS.length) + PARALLAX_MOTIONS.length) % PARALLAX_MOTIONS.length];

/** Đường dẫn các file đầu vào ffmpeg do prepareParallax ghi (thứ tự = thứ tự `-i` sau ảnh gốc). */
export type ParallaxFiles = { farFill: string; farPatch: string; midFill: string; midPatch: string; midAlpha: string; nearAlpha: string };

/** Hệ số chuyển động của lớp xa / giữa / gần: lớp gần đi nhiều nhất. */
export const LAYER_WEIGHTS = [0.3, 0.65, 1] as const;
/** Phóng canvas lớp lên 2× rồi mới zoompan: zoompan làm tròn toạ độ theo điểm ảnh nguồn → 2× để bước chỉ còn ½ điểm ảnh ở 1080p. */
export const CANVAS_SCALE = 2;

/** Biên độ máy quay tính cho LỚP GẦN (lớp khác nhân hệ số trong LAYER_WEIGHTS). Dịch là tỉ lệ cạnh khung, dương = nội dung trôi sang phải/xuống. */
export type CameraSpec = { zoomBase: number; zoomGain: number; shiftX: number; shiftY: number };

const TRUCK_SHIFT = 0.022;
const CRANE_SHIFT = 0.022;
/** Ảnh nền phóng sẵn để có chỗ trượt mà không lộ mép: ≥ 1/(1-2·dịch). */
const PAN_ZOOM_BASE = 1.05;

export function cameraFor(motion: ParallaxMotion): CameraSpec {
  switch (motion) {
    case "dollyIn":
      return { zoomBase: 1, zoomGain: 0.07, shiftX: 0, shiftY: 0 };
    case "truckRight":
      return { zoomBase: PAN_ZOOM_BASE, zoomGain: 0.02, shiftX: -TRUCK_SHIFT, shiftY: 0 };
    case "truckLeft":
      return { zoomBase: PAN_ZOOM_BASE, zoomGain: 0.02, shiftX: TRUCK_SHIFT, shiftY: 0 };
    case "craneUp":
      return { zoomBase: PAN_ZOOM_BASE, zoomGain: 0.02, shiftX: 0, shiftY: CRANE_SHIFT };
  }
}

/** Tiến độ có easing cos (chậm–nhanh–chậm), kẹp ở `motionFrames` rồi giữ nguyên (đứng yên, không rung). Biểu thức zoompan. */
export const easeExpr = (motionFrames: number) => `(0.5-0.5*cos(PI*min(on,${motionFrames})/${motionFrames}))`;

/** Giá trị easing thuần (cùng công thức với easeExpr) để test/kiểm tra biên. */
export const easeAt = (frame: number, motionFrames: number) => 0.5 - 0.5 * Math.cos((Math.PI * Math.min(frame, motionFrames)) / motionFrames);

/** Biểu thức zoompan (z, x, y) của 1 lớp (0 xa, 1 giữa, 2 gần) trên canvas đã phóng `CANVAS_SCALE`×. */
export function layerExpr(o: { motion: ParallaxMotion; layer: 0 | 1 | 2; w: number; h: number; motionFrames: number }) {
  const cam = cameraFor(o.motion);
  const k = LAYER_WEIGHTS[o.layer];
  const e = easeExpr(o.motionFrames);
  const f = (n: number) => Number(n.toFixed(5));
  const z = `${f(cam.zoomBase)}+${f(cam.zoomGain * k)}*${e}`;
  // Cửa sổ nhìn: tâm canvas lệch ngược chiều trôi của nội dung.
  const x = `(iw-iw/zoom)/2-${f(cam.shiftX * k * o.w * CANVAS_SCALE)}*${e}`;
  const y = `(ih-ih/zoom)/2-${f(cam.shiftY * k * o.h * CANVAS_SCALE)}*${e}`;
  return { z, x, y };
}

/** Lớp có để lộ mép canvas không: dịch tối đa (điểm ảnh ở khung ra) so với chỗ trượt có được tại zoom nhỏ nhất. Dùng để test biên. */
export function panRoomPx(motion: ParallaxMotion, w: number, h: number) {
  const cam = cameraFor(motion);
  const room = (side: number) => (side * (1 - 1 / cam.zoomBase)) / 2;
  return { x: room(w) - Math.abs(cam.shiftX) * w, y: room(h) - Math.abs(cam.shiftY) * h };
}

/** Chuỗi filter đưa ảnh gốc về đúng khung `w`×`h` (cắt logo, phủ kín, cắt lệch lên trên 30%): dùng chung cho mọi nơi để độ sâu khớp khung. */
export const canvasChain = (w: number, h: number, logoCrop = "") =>
  `${logoCrop}scale=${w}:${h}:force_original_aspect_ratio=increase:flags=bicubic,crop=${w}:${h}:(iw-ow)/2:(ih-oh)*0.3`;

/** Đầu vào ffmpeg của các file parallax (đứng sau `-i ảnh`): [1]=vá xa, [2]=alpha vá xa, [3]=vá giữa, [4]=alpha vá giữa, [5]=alpha giữa, [6]=alpha gần. */
export const parallaxInputArgs = (f: ParallaxFiles) =>
  [f.farFill, f.farPatch, f.midFill, f.midPatch, f.midAlpha, f.nearAlpha].flatMap((file) => ["-i", file]);

/**
 * Đồ thị filter_complex dựng 3 lớp từ ảnh [0] + file mặt nạ [1..6], mỗi lớp 1 zoompan riêng rồi chồng lại; ra nhãn [v] (yuv420p, w×h, fps).
 * Lớp xa = ảnh + miếng vá làm mờ ở chỗ vật giữa/gần (khỏi lộ "ma" khi vật trượt đi); lớp giữa = ảnh (đã vá chỗ lớp gần) × alpha giữa; lớp gần = ảnh × alpha gần.
 * `canvasExtra` chèn thêm filter vào canvas (vd làm nét) trước khi tách lớp.
 */
export function parallaxFilterGraph(o: { w: number; h: number; frames: number; motionFrames: number; fps: number; motion: ParallaxMotion; logoCrop?: string; canvasExtra?: string; scaleFlags?: string }) {
  const S = CANVAS_SCALE;
  // Chỉ `moving` khung đầu đi qua đồ thị 3 lớp; phần còn lại nhân bản khung cuối (tpad) — rẻ hơn ~20× so với dựng lại từng khung đứng yên.
  const moving = Math.max(1, Math.min(o.motionFrames, o.frames));
  const hold = o.frames - moving;
  const cw = o.w * S;
  const ch = o.h * S;
  const flags = o.scaleFlags ?? "bicubic";
  const up = (n: number, fmt: string) => `[${n}:v]scale=${cw}:${ch}:flags=${flags},format=${fmt}`;
  const zoom = (layer: 0 | 1 | 2) => {
    const { z, x, y } = layerExpr({ motion: o.motion, layer, w: o.w, h: o.h, motionFrames: o.motionFrames });
    return `zoompan=z='${z}':x='${x}':y='${y}':d=${moving}:s=${o.w}x${o.h}:fps=${o.fps}`;
  };
  return [
    `[0:v]${canvasChain(cw, ch, o.logoCrop ?? "")},${o.canvasExtra ? `${o.canvasExtra},` : ""}format=yuv420p,split=3[c0][c1][c2]`,
    `${up(1, "yuv420p")}[ff]`, `${up(2, "gray")}[fp]`, "[ff][fp]alphamerge[ffa]",
    `${up(3, "yuv420p")}[mf]`, `${up(4, "gray")}[mp]`, "[mf][mp]alphamerge[mfa]",
    `${up(5, "gray")}[ma]`, `${up(6, "gray")}[na]`,
    "[c0][ffa]overlay=format=yuv420[l0]",
    "[c1][mfa]overlay=format=yuv420[l1o]", "[l1o][ma]alphamerge[l1]",
    "[c2][na]alphamerge[l2]",
    `[l0]${zoom(0)},format=yuv420p[z0]`,
    `[l1]${zoom(1)},format=yuva420p[z1]`,
    `[l2]${zoom(2)},format=yuva420p[z2]`,
    "[z0][z1]overlay=format=yuv420[o1]",
    `[o1][z2]overlay=format=yuv420,tmix=frames=2${hold > 0 ? `,tpad=stop_mode=clone:stop=${hold}` : ""},format=yuv420p[v]`,
  ].join(";");
}

/** Tên file/thư mục tạm của parallax cho 1 ảnh (cạnh ảnh) — xoá sau khi dựng xong đoạn. */
export const parallaxWorkDir = (img: string) => `${img}.px`;

// ── Chọn ảnh/đoạn nào được áp parallax theo ngân sách ─────────────────────────

export type ParallaxScene = { start: number; end: number; /** 2 phút đầu của chương (bắt buộc áp). */ zoom?: boolean; /** Cảnh hành động (scene prompt có cờ action). */ action?: boolean };
export type ParallaxSpan = { /** Số giây chuyển động tính từ đầu đoạn (0 = không áp); phần còn lại của đoạn đứng yên ở khung cuối. */ seconds: number };

export type ParallaxBudget = {
  /** Tổng giây parallax tối đa cho phần KHÔNG bắt buộc (ngoài 2 phút đầu). */
  extraSeconds: number;
  /** Cảnh thường chỉ áp ngần này giây đầu ảnh rồi giữ tĩnh. */
  headSeconds: number;
  /** Cảnh action được áp dài hơn (giây). */
  actionSeconds: number;
};

/**
 * Chọn đoạn parallax cho từng ảnh của chương: 2 phút đầu (zoom) luôn đủ cả đoạn; phần sau ưu tiên cảnh action
 * (`actionSeconds`), rồi các ảnh còn lại `headSeconds` đầu, rải đều theo thời gian cho tới khi hết `extraSeconds`. Ảnh nào không được chọn → 0.
 */
export function planParallax(scenes: ParallaxScene[], budget: ParallaxBudget): ParallaxSpan[] {
  const spans = scenes.map((s) => ({ seconds: s.zoom ? s.end - s.start : 0 }));
  let left = budget.extraSeconds;
  const give = (i: number, want: number) => {
    const sec = Math.min(want, scenes[i].end - scenes[i].start);
    if (sec <= 0 || sec > left) return;
    spans[i].seconds = sec;
    left -= sec;
  };
  const rest = scenes.map((s, i) => i).filter((i) => !scenes[i].zoom);
  for (const i of rest.filter((j) => scenes[j].action)) give(i, budget.actionSeconds);
  const plain = rest.filter((j) => !scenes[j].action);
  // Rải đều: ưu tiên ảnh cách nhau xa trước (bước nhảy lớn → nhỏ) để khi hết ngân sách thì parallax vẫn phân bố khắp chương.
  const order = spreadOrder(plain.length).map((k) => plain[k]);
  for (const i of order) give(i, budget.headSeconds);
  return spans;
}

/** Thứ tự duyệt 0..n-1 sao cho các phần tử đầu rải đều (bit-reversal gần đúng): 0, n/2, n/4, 3n/4, … */
export function spreadOrder(n: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let step = n; step >= 1; step = Math.floor(step / 2)) {
    for (let i = 0; i < n; i += step) if (!seen.has(i)) { seen.add(i); out.push(i); }
    if (step === 1) break;
  }
  return out;
}

/** Ngân sách mặc định cho chương 40 phút (đo trên Mac `-threads 2`, xem commit): xem bảng đo trong mô tả commit. */
export const PARALLAX_BUDGET: ParallaxBudget = { extraSeconds: 300, headSeconds: 8, actionSeconds: 12 };
