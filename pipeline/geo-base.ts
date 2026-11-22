// Nền bản đồ dùng chung cho cảnh bản đồ phẳng (scene-map) và cảnh địa hình 3D (scene-terrain):
// khung ôm các địa danh, chiếu toạ độ lên khung hình, và hình đất/sông/bờ biển từ Natural Earth (public domain).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeoPoint } from "@/lib/story/geocode";

/** Khung bản đồ theo độ (tây, đông, nam, bắc). */
export type GeoBox = { w: number; e: number; s: number; n: number };

/** Đệm quanh mép khung để địa danh ngoài cùng không dính biên. */
export const BOX_PADDING = 0.25;
/** Khung nhỏ nhất (độ vĩ) khi mọi địa danh trùng nhau. */
const MIN_SPAN_DEG = 0.3;
const DEG_TO_RAD = Math.PI / 180;

/** Khung 16:9 ôm hết các điểm (có đệm); kinh độ nhân cos(vĩ độ) để không bị dẹt. */
export function boxFor(points: GeoPoint[], aspect: number): GeoBox {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const cos = Math.cos(midLat * DEG_TO_RAD);
  const needLat = Math.max(MIN_SPAN_DEG, (Math.max(...lats) - Math.min(...lats)) * (1 + BOX_PADDING * 2));
  const needLon = Math.max(MIN_SPAN_DEG, (Math.max(...lons) - Math.min(...lons)) * (1 + BOX_PADDING * 2));
  // Giữ tỉ lệ: lấy cạnh nào "thiếu" thì nới ra.
  const latSpan = Math.max(needLat, (needLon * cos) / aspect);
  const lonSpan = (latSpan * aspect) / cos;
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  return { w: midLon - lonSpan / 2, e: midLon + lonSpan / 2, s: midLat - latSpan / 2, n: midLat + latSpan / 2 };
}

/** Hàm chiếu toạ độ (kinh, vĩ) → điểm ảnh trong khung `w`×`h`. */
export function projector(box: GeoBox, w: number, h: number) {
  return (lon: number, lat: number): [number, number] => [((lon - box.w) / (box.e - box.w)) * w, ((box.n - lat) / (box.n - box.s)) * h];
}

/** Hình nền bản đồ: Natural Earth 1:10m, public domain. 15 MB nên tải lúc chạy vào `.render/geo` (cache Actions giữ lại). */
export const GEO_FILES = ["ne_10m_land", "ne_10m_coastline", "ne_10m_rivers_lake_centerlines"] as const;
const GEO_SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

/** Tải dữ liệu bản đồ nếu chưa có; trả về thư mục chứa. */
export async function ensureGeoData(dir = path.resolve(".render", "geo")): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const name of GEO_FILES) {
    const file = path.join(dir, `${name}.geojson`);
    if (await readFile(file).then(() => true, () => false)) continue;
    const res = await fetch(`${GEO_SOURCE}/${name}.geojson`);
    if (!res.ok) throw new Error(`Tải ${name} lỗi ${res.status}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
  }
  return dir;
}

type Geometry = { type: string; coordinates: unknown };

/** Mọi đường/viền của một hình (LineString, Polygon, Multi…) thành danh sách toạ độ. */
function ringsOf(geometry: Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates as number[][]];
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") return geometry.coordinates as number[][][];
  if (geometry.type === "MultiPolygon") return (geometry.coordinates as number[][][][]).flat();
  return [];
}

/** Đường nào có ít nhất một điểm gần khung (nới 1°) thì giữ — vẽ cả đường để không đứt ở mép. */
const touchesBox = (ring: number[][], box: GeoBox) =>
  ring.some(([lon, lat]) => lon > box.w - 1 && lon < box.e + 1 && lat > box.s - 1 && lat < box.n + 1);

export type MapShapes = { land: number[][][]; rivers: number[][][]; coast: number[][][] };

/** Số khung bản đồ giữ lại trong bộ nhớ — mỗi khung giữ cả hình đất/sông/bờ biển nên không giữ vô hạn. */
const SHAPE_CACHE_MAX = 6;
/** Hình đã lọc theo khung, giữ lại cho cảnh sau: 3 file geojson gốc gần 30 MB, đọc + parse lại mỗi cảnh là đắt. */
const shapeCache = new Map<string, Promise<MapShapes>>();

/**
 * Hình đất, sông, bờ biển trong khung. Khung nào đã đọc thì dùng lại luôn — một cảnh thường cần hình hai lần
 * (bản đồ phẳng và địa hình 3D cùng khung), và các cảnh cùng tuyến hành quân cho ra đúng một khung.
 */
export function loadShapes(box: GeoBox, dir?: string): Promise<MapShapes> {
  const key = `${dir ?? ""}|${box.w},${box.e},${box.s},${box.n}`;
  const cached = shapeCache.get(key);
  if (cached) return cached;
  // Đọc lỗi thì bỏ khỏi cache, để lần sau còn đọc lại được thay vì nhớ mãi cái lỗi.
  const job = readShapes(box, dir).catch((err: unknown) => {
    shapeCache.delete(key);
    throw err;
  });
  shapeCache.set(key, job);
  if (shapeCache.size > SHAPE_CACHE_MAX) {
    const oldest = shapeCache.keys().next().value;
    if (oldest) shapeCache.delete(oldest);
  }
  return job;
}

async function readShapes(box: GeoBox, dir?: string): Promise<MapShapes> {
  const geoDir = await ensureGeoData(dir);
  const read = async (name: string) => {
    const fc = JSON.parse(await readFile(path.join(geoDir, `${name}.geojson`), "utf8")) as { features: { geometry: Geometry }[] };
    return fc.features.flatMap((f) => ringsOf(f.geometry)).filter((ring) => touchesBox(ring, box));
  };
  const [land, coast, rivers] = await Promise.all([read("ne_10m_land"), read("ne_10m_coastline"), read("ne_10m_rivers_lake_centerlines")]);
  return { land, coast, rivers };
}

/** Danh sách toạ độ → đường SVG ("M…L…"), đóng kín nếu là vùng đất. */
export function pathData(ring: number[][], project: (lon: number, lat: number) => [number, number], closed: boolean): string {
  const points = ring.map((c, i) => `${i ? "L" : "M"}${project(c[0], c[1]).map((v) => v.toFixed(1)).join(",")}`);
  return points.join("") + (closed ? "Z" : "");
}
