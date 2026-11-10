/** JSON ổn định (khoá object sắp xếp) để so sánh hai lần đọc DB mà không bị khác vì thứ tự khoá. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

export type EventChange<K extends string> = { event: K; json: string };

/**
 * So dữ liệu mới với lần đã gửi: chỉ trả sự kiện đổi nội dung. `next[k] === undefined` = lần này không đo khoá đó (giữ nguyên).
 * `state` là chuỗi đã gửi mới nhất của từng khoá — truyền lại làm `prev` ở lần sau.
 */
export function diffEvents<K extends string>(prev: Partial<Record<K, string>>, next: Partial<Record<K, unknown>>): { changed: EventChange<K>[]; state: Partial<Record<K, string>> } {
  const state = { ...prev };
  const changed: EventChange<K>[] = [];
  for (const key of Object.keys(next) as K[]) {
    if (next[key] === undefined) continue;
    const json = stableJson(next[key]);
    if (json === prev[key]) continue;
    state[key] = json;
    changed.push({ event: key, json });
  }
  return { changed, state };
}

/** Một khung SSE. `json` không chứa xuống dòng (JSON.stringify không sinh ra). */
export function formatSse(event: string, json: string): string {
  return `event: ${event}\ndata: ${json}\n\n`;
}

/** Chờ nối lại: 1s, 2s, 4s… tối đa 30s, cộng nhiễu ≤25% để nhiều tab không nối cùng lúc. */
export function backoffMs(failures: number, rand: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (1 + rand() * 0.25));
}
