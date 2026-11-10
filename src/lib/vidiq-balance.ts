import { closeVidiq, callVidiq } from "../../pipeline/vidiq";
import { loadSecrets } from "@/lib/secrets";

/** Số dư credit vidIQ (tool vidiq_balance, không tốn credit). Định dạng vidIQ không công bố → đọc mềm các trường số. */
export type VidiqBalance = { remaining: number | null; total: number | null; used: number | null; resetAt: string | null; plan: string | null; raw: string };

let cache: { at: number; value: VidiqBalance | null } | null = null;

/** Tìm giá trị đầu tiên có tên khớp regex trong JSON lồng nhau. */
function find(o: unknown, re: RegExp): unknown {
  if (!o || typeof o !== "object") return undefined;
  for (const [k, v] of Object.entries(o)) {
    if (re.test(k) && (typeof v === "number" || typeof v === "string")) return v;
  }
  for (const v of Object.values(o)) {
    const hit = find(v, re);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);

export function parseBalance(raw: string): VidiqBalance {
  let j: unknown = null;
  try {
    j = JSON.parse(raw);
  } catch {
    /* văn bản thường */
  }
  const fromText = (re: RegExp) => num(raw.match(re)?.[1]);
  const remaining = num(find(j, /remain|balance|available|left/i)) ?? fromText(/(?:remaining|balance|left)\D{0,12}(\d+)/i);
  const total = num(find(j, /total|limit|allowance|monthly|quota/i)) ?? fromText(/(?:total|limit|of)\D{0,6}(\d+)/i);
  const used = num(find(j, /used|spent|consumed/i)) ?? (remaining != null && total != null ? total - remaining : null);
  const reset = find(j, /reset|renew|refill|period.?end|next/i);
  const plan = find(j, /plan|tier/i);
  return { remaining, total, used, resetAt: typeof reset === "string" ? reset : null, plan: typeof plan === "string" ? plan : null, raw: raw.slice(0, 600) };
}

/** Lấy số dư (nhớ 5 phút). Không có key / lỗi → null, trang vẫn hiện bình thường. */
export async function vidiqBalance(): Promise<VidiqBalance | null> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.value;
  let value: VidiqBalance | null = null;
  try {
    await loadSecrets();
    if (process.env.VIDIQ_API_KEY) {
      const raw = await callVidiq("vidiq_balance", {});
      value = raw ? parseBalance(raw) : null;
    }
  } catch (e) {
    console.warn("vidIQ balance lỗi:", e instanceof Error ? e.message : e);
  } finally {
    await closeVidiq().catch(() => {});
  }
  cache = { at: Date.now(), value };
  return value;
}
