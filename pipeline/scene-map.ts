// Cảnh bản đồ phẳng: mũi tên hành quân mọc dần, nhãn địa danh hiện khi mũi tên chạm, điểm nổ ở nơi giao chiến,
// lính giấy (sprite do Codex vẽ) chạy ở đầu mũi tên. Tông TRẦM — không rực như kênh tham chiếu.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { GeoPoint } from "@/lib/story/geocode";
import type { Shot } from "@/lib/story/storyboard";
import { boxFor, loadShapes, pathData, projector, type MapShapes } from "./geo-base";
import { ffmpeg } from "./ffmpeg";
import type { SpriteKind } from "./sprites";

export const MAP_W = 1920;
export const MAP_H = 1080;
export const MAP_FPS = 25;
const ASPECT = MAP_W / MAP_H;

/** Bảng màu trầm của kênh (kênh tham chiếu dùng đỏ/xanh rực — chủ kênh chốt tông trầm). */
export const MAP_PALETTE = {
  sea: "#1c3647",
  land: "#b9a375",
  river: "#2f6f9a",
  coast: "#6b5530",
  route: "#b3362a",
  routeShadow: "#6d1c14",
  label: "#ffffff",
  labelInk: "#111111",
  tag: "#d8ad2e",
  caption: "#2a2422",
  burst: "#e0a52c",
} as const;

/** Mũi tên bắt đầu mọc và mọc xong ở phần nào của cảnh. */
const DRAW_FROM = 0.12;
const DRAW_TO = 0.86;
const LABEL_FADE = 0.4;
/** Hai nhãn gần hơn ngần này (px dọc) là đè chữ — đẩy ra và nối bằng đường chỉ. */
export const LABEL_MIN_GAP = 56;
const LABEL_SIZE = 42;
const LABEL_SIZE_CAPITAL = 54;
const DOT_RADIUS = 11;
const DOT_RADIUS_CAPITAL = 15;
const LABEL_OFFSET_X = 24;
const LABEL_BASELINE = 15;
const LABEL_STROKE = 9;
/** Nhãn lệch khỏi chấm quá ngần này thì vẽ đường chỉ về chấm. */
const LEADER_MIN_SHIFT = 10;
const CURVE_SLACK = 1.08;
const BEZIER_TENSION = 6;
const EASE_HALF = 0.5;

export type MapFrame = {
  shot: Shot;
  places: Map<string, GeoPoint>;
  shapes: MapShapes;
  t: number;
  /** Ảnh sprite nền trong suốt theo loại quân (data URI); rỗng thì không vẽ lính. */
  sprites: Partial<Record<SpriteKind, string>>;
  /** Nền (biển/đất/sông/bờ biển) dựng sẵn bằng `baseLayersSvg`; bỏ trống thì tự dựng lại cho khung này. */
  base?: string;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Vào/ra mượt — tránh cảm giác giật ở đầu và cuối. */
const ease = (x: number) => (x < EASE_HALF ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Địa danh của cảnh đã tra được toạ độ (theo thứ tự tuyến hành quân). */
function knownPlaces(shot: Shot, places: Map<string, GeoPoint>): string[] {
  return (shot.route ?? shot.places ?? []).filter((name) => places.has(name));
}

/** Khung bản đồ ôm hết địa danh của cảnh. */
function boxOf(known: string[], places: Map<string, GeoPoint>) {
  return boxFor(known.map((name) => places.get(name)!), ASPECT);
}

/** Hàm chiếu của cảnh — cố định suốt cảnh, nên mọi khung hình của cảnh chiếu giống nhau. */
function projectorFor(known: string[], places: Map<string, GeoPoint>) {
  return projector(boxOf(known, places), MAP_W, MAP_H);
}

/** Đường cong mềm qua các điểm (Catmull-Rom → Bezier) + độ dài gần đúng + mốc tiến độ từng điểm. */
function routeCurve(points: [number, number][]) {
  const segments = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = segments.reduce((a, b) => a + b, 0) || 1;
  let walked = 0;
  const marks = [0, ...segments.map((s) => (walked += s) / total)];
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const before = points[i - 1] ?? points[i];
    const [from, to] = [points[i], points[i + 1]];
    const after = points[i + 2] ?? to;
    const c1 = [from[0] + (to[0] - before[0]) / BEZIER_TENSION, from[1] + (to[1] - before[1]) / BEZIER_TENSION];
    const c2 = [to[0] - (after[0] - from[0]) / BEZIER_TENSION, to[1] - (after[1] - from[1]) / BEZIER_TENSION];
    d += ` C${c1.map((v) => v.toFixed(1)).join(",")} ${c2.map((v) => v.toFixed(1)).join(",")} ${to.map((v) => v.toFixed(1)).join(",")}`;
  }
  return { d, length: total * CURVE_SLACK, marks };
}

/** Điểm trên tuyến ở tiến độ `at` (0–1). */
function pointOnRoute(points: [number, number][], marks: number[], at: number): [number, number] {
  const i = Math.max(0, Math.min(points.length - 2, marks.findIndex((m) => m >= at) - 1));
  const span = (marks[i + 1] ?? 1) - marks[i] || 1;
  const k = clamp01((at - marks[i]) / span);
  const [from, to] = [points[i], points[i + 1] ?? points[i]];
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k];
}

/** Một nhãn trước khi dàn: vị trí chấm trên bản đồ. */
export type LabelSpot = { name: string; x: number; y: number; capital: boolean; opacity: number };
/** Nhãn sau khi dàn: `labelY` là chỗ đặt chữ (có thể lệch khỏi chấm để không đè nhãn khác). */
export type PlacedLabel = LabelSpot & { labelY: number };

/**
 * Dàn nhãn theo chiều dọc: nhãn nào cách nhãn trên gần hơn LABEL_MIN_GAP thì đẩy xuống.
 * Địa danh sát nhau (Hà Hồi – Ngọc Hồi – Đống Đa – Thăng Long chỉ cách nhau vài km) sẽ chồng chữ nếu không dàn.
 */
export function layoutLabels(spots: LabelSpot[]): PlacedLabel[] {
  const sorted = [...spots].sort((a, b) => a.y - b.y);
  let lastY = -Infinity;
  const placed = sorted.map((spot) => {
    const labelY = Math.max(spot.y, lastY + LABEL_MIN_GAP);
    lastY = labelY;
    return { ...spot, labelY };
  });
  return spots.map((spot) => placed.find((p) => p.name === spot.name)!);
}

function labelSvg(label: PlacedLabel) {
  const { name, x, y, labelY, capital, opacity } = label;
  const size = capital ? LABEL_SIZE_CAPITAL : LABEL_SIZE;
  const radius = capital ? DOT_RADIUS_CAPITAL : DOT_RADIUS;
  const leader =
    Math.abs(labelY - y) > LEADER_MIN_SHIFT
      ? `<line data-leader="1" x1="${(x + radius).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + LABEL_OFFSET_X - 4).toFixed(1)}" y2="${(labelY + 2).toFixed(1)}" stroke="${MAP_PALETTE.labelInk}" stroke-width="3" opacity="0.8"/>`
      : "";
  return `<g opacity="${opacity.toFixed(2)}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius}" fill="${MAP_PALETTE.tag}" stroke="${MAP_PALETTE.labelInk}" stroke-width="4"/>${leader}
<text x="${(x + LABEL_OFFSET_X).toFixed(1)}" y="${(labelY + LABEL_BASELINE).toFixed(1)}" font-family="Be Vietnam Pro" font-weight="700" font-size="${size}" fill="${MAP_PALETTE.label}" stroke="${MAP_PALETTE.labelInk}" stroke-width="${LABEL_STROKE}" paint-order="stroke">${escapeXml(name)}</text></g>`;
}

function burstSvg(x: number, y: number, k: number) {
  const r = 26 + 46 * k;
  const points = Array.from({ length: 16 }, (_, j) => {
    const angle = (j / 16) * Math.PI * 2;
    const radius = j % 2 ? r * 0.45 : r;
    return `${(x + Math.cos(angle) * radius).toFixed(1)},${(y + Math.sin(angle) * radius).toFixed(1)}`;
  }).join(" ");
  return `<polygon data-burst="1" points="${points}" fill="${MAP_PALETTE.burst}" stroke="${MAP_PALETTE.route}" stroke-width="4" opacity="${(1 - 0.6 * k).toFixed(2)}"/>`;
}

/** Tên hiển thị: bỏ phần tỉnh/nước sau dấu phẩy, viết hoa. */
export const displayName = (query: string) => query.split(",")[0].trim().toUpperCase();

/**
 * Nền bản đồ: biển, đất, sông, bờ biển. Nền không đổi trong suốt một cảnh — hình đất/sông là hàng nghìn đường,
 * dựng lại cho từng khung (25 khung/giây) là phần tốn nhất của cảnh bản đồ. Dựng một lần rồi truyền vào `MapFrame.base`.
 */
export function baseLayersSvg(shapes: MapShapes, project: (lon: number, lat: number) => [number, number]): string {
  return `<rect width="${MAP_W}" height="${MAP_H}" fill="${MAP_PALETTE.sea}"/>
<g fill="${MAP_PALETTE.land}">${shapes.land.map((r) => `<path d="${pathData(r, project, true)}"/>`).join("")}</g>
<g fill="none" stroke="${MAP_PALETTE.river}" stroke-width="7" stroke-linecap="round">${shapes.rivers.map((r) => `<path d="${pathData(r, project, false)}"/>`).join("")}</g>
<g fill="none" stroke="${MAP_PALETTE.coast}" stroke-width="2.5">${shapes.coast.map((r) => `<path d="${pathData(r, project, false)}"/>`).join("")}</g>`;
}

/** Một khung hình của cảnh bản đồ (SVG). */
export function mapFrameSvg({ shot, places, shapes, t, sprites, base }: MapFrame): string {
  const length = Math.max(0.001, shot.end - shot.start);
  const progress = clamp01((t - shot.start) / length);
  const drawn = ease(clamp01((progress - DRAW_FROM) / (DRAW_TO - DRAW_FROM)));
  const known = knownPlaces(shot, places);
  const project = projectorFor(known, places);
  const points = known.map((n) => project(places.get(n)!.lon, places.get(n)!.lat));
  const curve = points.length > 1 ? routeCurve(points) : null;

  const visible: LabelSpot[] = known.flatMap((name, i) => {
    const at = curve ? curve.marks[i] : 0;
    const opacity = clamp01((drawn - at + LABEL_FADE) / LABEL_FADE);
    // Nhãn chưa tới lượt hiện thì bỏ hẳn khỏi SVG (nhẹ hơn, và không lộ chữ khi đo khung hình).
    if (opacity <= 0) return [];
    return [{ name: displayName(name), x: points[i][0], y: points[i][1], capital: i === known.length - 1, opacity }];
  });
  const labels = layoutLabels(visible).map(labelSvg).join("");

  const bursts = (shot.battles ?? [])
    .filter((name) => places.has(name))
    .map((name) => {
      const at = curve ? curve.marks[known.indexOf(name)] ?? 0 : 0;
      if (drawn < at) return "";
      const [x, y] = project(places.get(name)!.lon, places.get(name)!.lat);
      return burstSvg(x, y, clamp01((drawn - at) / 0.18));
    })
    .join("");

  const sprite = sprites.infantry;
  const army =
    sprite && curve && drawn > 0.02 && drawn < 0.99
      ? (() => {
          const [hx, hy] = pointOnRoute(points, curve.marks, drawn);
          return Array.from({ length: 3 }, (_, i) => {
            const bob = Math.abs(Math.sin(t * 7 + i * 1.6)) * 7;
            return `<image href="${sprite}" x="${(hx - 44 * i - 60).toFixed(1)}" y="${(hy - 110 - bob).toFixed(1)}" width="110" height="110"/>`;
          }).join("");
        })()
      : "";

  const tagIn = clamp01(progress / 0.12);
  const captionIn = clamp01((progress - 0.18) / 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MAP_W}" height="${MAP_H}" viewBox="0 0 ${MAP_W} ${MAP_H}">
${base ?? baseLayersSvg(shapes, project)}
${curve ? `<path d="${curve.d}" fill="none" stroke="${MAP_PALETTE.routeShadow}" stroke-width="30" stroke-linecap="round" stroke-dasharray="${curve.length.toFixed(1)}" stroke-dashoffset="${(curve.length * (1 - drawn)).toFixed(1)}" opacity="0.55"/>
<path d="${curve.d}" fill="none" stroke="${MAP_PALETTE.route}" stroke-width="18" stroke-linecap="round" stroke-dasharray="${curve.length.toFixed(1)}" stroke-dashoffset="${(curve.length * (1 - drawn)).toFixed(1)}"/>` : ""}
${labels}${bursts}${army}
${shot.title ? `<g transform="translate(${(-400 * (1 - tagIn)).toFixed(1)},0)"><rect x="50" y="46" width="700" height="112" fill="${MAP_PALETTE.tag}" stroke="${MAP_PALETTE.labelInk}" stroke-width="5"/>
<text x="80" y="126" font-family="Be Vietnam Pro" font-weight="700" font-size="56" fill="${MAP_PALETTE.labelInk}">${escapeXml(shot.title)}</text></g>` : ""}
${shot.subtitle ? `<g opacity="${captionIn.toFixed(2)}"><rect x="${MAP_W / 2 - 560}" y="${MAP_H - 150}" width="1120" height="96" fill="${MAP_PALETTE.caption}" opacity="0.9" stroke="${MAP_PALETTE.labelInk}" stroke-width="3"/>
<text x="${MAP_W / 2}" y="${MAP_H - 86}" text-anchor="middle" font-family="Playfair Display" font-size="50" fill="#f3e6c8">${escapeXml(shot.subtitle)}</text></g>` : ""}
</svg>`;
}

export type MapScene = { shot: Shot; places: Map<string, GeoPoint>; sprites: Partial<Record<SpriteKind, string>>; dir: string; out: string };

/** Dựng cảnh bản đồ ra mp4: vẽ từng khung bằng SVG → PNG rồi ghép. */
export async function renderMapScene({ shot, places, sprites, dir, out }: MapScene) {
  const known = knownPlaces(shot, places);
  if (!known.length) {
    throw new Error(`Cảnh bản đồ không có địa danh nào tra được toạ độ: ${(shot.route ?? shot.places ?? []).join(", ")}`);
  }
  const shapes = await loadShapes(boxOf(known, places));
  // Nền dựng MỘT lần cho cả cảnh — không dựng lại hàng nghìn đường đất/sông cho từng khung.
  const base = baseLayersSvg(shapes, projectorFor(known, places));
  const frames = path.join(dir, "frames");
  await mkdir(frames, { recursive: true });
  const fonts = [path.resolve("pipeline/fonts/BeVietnamPro-Bold.ttf"), path.resolve("pipeline/fonts/PlayfairDisplay-Black.ttf")];
  const count = Math.max(1, Math.round((shot.end - shot.start) * MAP_FPS));
  for (let i = 0; i < count; i++) {
    const svg = mapFrameSvg({ shot, places, shapes, sprites, base, t: shot.start + i / MAP_FPS });
    const png = new Resvg(svg, { font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: "Be Vietnam Pro" } }).render().asPng();
    await writeFile(path.join(frames, `f${String(i).padStart(5, "0")}.png`), png);
  }
  await ffmpeg(["-framerate", String(MAP_FPS), "-i", path.join(frames, "f%05d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out]);
}
