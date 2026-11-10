/** Cắt (không làm tròn, như YouTube) `n / div` còn tối đa 1 chữ số thập phân, dấu phẩy kiểu Việt. */
function scaled(n: number, div: number, unit: string, decimals: boolean): string {
  const v = decimals ? Math.floor((n / div) * 10) / 10 : Math.floor(n / div);
  return `${String(v).replace(".", ",")}${unit}`;
}

/** Số lượt kiểu YouTube tiếng Việt: 999 · 1,2N · 34N · 3,4Tr · 12Tr · 1,5Tỷ. Số âm/NaN coi là 0. */
export function formatCount(n: number): string {
  const x = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  if (x < 1_000) return String(x);
  if (x < 10_000) return scaled(x, 1_000, "N", true);
  if (x < 1_000_000) return scaled(x, 1_000, "N", false);
  if (x < 10_000_000) return scaled(x, 1_000_000, "Tr", true);
  if (x < 1_000_000_000) return scaled(x, 1_000_000, "Tr", false);
  return scaled(x, 1_000_000_000, "Tỷ", true);
}
