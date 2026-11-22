// Toạ độ địa danh cho cảnh bản đồ: hỏi OpenStreetMap Nominatim một lần rồi nhớ trong bảng `places`
// (Nominatim cho tối đa 1 lượt/giây — tra lại mỗi lần render là vi phạm và chậm).
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { places } from "@/db/schema";
import { realSleep, type Sleep } from "./wiki-api";

export type GeoPoint = { lat: number; lon: number };
/** Kho toạ độ đã tra (bảng `places`); test thay bằng bản trong bộ nhớ. */
export type PlaceStore = {
  read(query: string): Promise<{ found: boolean; point: GeoPoint | null }>;
  write(query: string, point: GeoPoint | null): Promise<void>;
};

/** Nominatim yêu cầu tối đa 1 lượt/giây — chờ hơn 1 giây cho chắc. */
export const NOMINATIM_GAP_MS = 1100;
const USER_AGENT = "ma-ton-studio/1.0 (history research bot)";

/** Kho mặc định: bảng `places`; lat NULL = đã tra và không tìm thấy (khỏi hỏi lại). */
export const dbPlaceStore: PlaceStore = {
  async read(query) {
    const [row] = await db().select().from(places).where(eq(places.query, query));
    if (!row) return { found: false, point: null };
    return { found: true, point: row.lat == null || row.lon == null ? null : { lat: row.lat, lon: row.lon } };
  },
  async write(query, point) {
    await db()
      .insert(places)
      .values({ query, lat: point?.lat ?? null, lon: point?.lon ?? null })
      .onConflictDoUpdate({ target: places.query, set: { lat: point?.lat ?? null, lon: point?.lon ?? null, updatedAt: new Date() } });
  },
};

/** Toạ độ của một địa danh; chưa tra bao giờ thì hỏi Nominatim rồi nhớ lại. Không tìm thấy / lỗi mạng → null. */
export async function geocodePlace(query: string, store: PlaceStore = dbPlaceStore): Promise<GeoPoint | null> {
  const known = await store.read(query);
  if (known.found) return known.point;
  const params = new URLSearchParams({ q: query, format: "json", limit: "1" });
  const point = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { "User-Agent": USER_AGENT } })
    .then(async (res) => {
      if (!res.ok) return null;
      const [first] = (await res.json()) as { lat: string; lon: string }[];
      return first ? { lat: Number(first.lat), lon: Number(first.lon) } : null;
    })
    .catch((e: unknown) => {
      console.warn(`⚠ Tra toạ độ "${query}" lỗi:`, e instanceof Error ? e.message : e);
      return null;
    });
  await store.write(query, point);
  return point;
}

/** Toạ độ của nhiều địa danh (bỏ qua chỗ không tra được), chờ giữa các lượt gọi mạng. */
export async function geocodeAll(queries: string[], store: PlaceStore = dbPlaceStore, sleep: Sleep = realSleep): Promise<Map<string, GeoPoint>> {
  const found = new Map<string, GeoPoint>();
  const unique = [...new Set(queries)];
  for (const [i, query] of unique.entries()) {
    if (i > 0) await sleep(NOMINATIM_GAP_MS);
    const point = await geocodePlace(query, store);
    if (point) found.set(query, point);
  }
  return found;
}

/** Điểm nằm trong khung bản đồ. */
export const inBounds = (p: GeoPoint, box: { w: number; e: number; s: number; n: number }) =>
  p.lon >= box.w && p.lon <= box.e && p.lat >= box.s && p.lat <= box.n;
