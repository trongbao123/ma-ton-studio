import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAll, geocodePlace, inBounds, NOMINATIM_GAP_MS, type PlaceStore } from "./geocode";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const hit = [{ lat: "20.1234", lon: "105.9876" }];

/** Kho toạ độ giả thay cho bảng places — test không chạm DB. */
function memoryStore(): PlaceStore & { saved: Map<string, { lat: number; lon: number } | null> } {
  const saved = new Map<string, { lat: number; lon: number } | null>();
  return {
    saved,
    read: async (query) => (saved.has(query) ? { found: true, point: saved.get(query)! } : { found: false, point: null }),
    write: async (query, point) => void saved.set(query, point),
  };
}

describe("tra toạ độ địa danh", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("hỏi Nominatim một lần rồi nhớ lại, lần sau không gọi mạng", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json(hit));
    vi.stubGlobal("fetch", fetchSpy);
    const store = memoryStore();
    expect(await geocodePlace("Tam Điệp, Ninh Bình", store)).toEqual({ lat: 20.1234, lon: 105.9876 });
    expect(await geocodePlace("Tam Điệp, Ninh Bình", store)).toEqual({ lat: 20.1234, lon: 105.9876 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "User-Agent": expect.stringContaining("ma-ton-studio") });
  });

  it("không tìm thấy → null, và nhớ luôn để lần sau khỏi hỏi lại", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchSpy);
    const store = memoryStore();
    expect(await geocodePlace("Chỗ không có thật", store)).toBeNull();
    expect(await geocodePlace("Chỗ không có thật", store)).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("Nominatim lỗi mạng → null, không ném", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await geocodePlace("Tam Điệp", memoryStore())).toBeNull();
  });

  it("tra nhiều địa danh thì chờ giữa các lượt, bỏ qua chỗ không tra được", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(json(hit)).mockResolvedValueOnce(json([])).mockResolvedValueOnce(json(hit));
    vi.stubGlobal("fetch", fetchSpy);
    const sleep = vi.fn(async () => {});
    const found = await geocodeAll(["A", "B", "C"], memoryStore(), sleep);
    expect([...found.keys()]).toEqual(["A", "C"]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(NOMINATIM_GAP_MS);
  });
});

describe("điểm nằm trong khung bản đồ", () => {
  it("trong khung thì đúng, ngoài khung thì sai", () => {
    const box = { w: 105, e: 106, s: 20, n: 21 };
    expect(inBounds({ lat: 20.5, lon: 105.5 }, box)).toBe(true);
    expect(inBounds({ lat: 22, lon: 105.5 }, box)).toBe(false);
  });
});
