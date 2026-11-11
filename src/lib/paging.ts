/** Số trang hiển thị: 1 … (trang−1, trang, trang+1) … cuối; null = dấu "…". */
export function pageList(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | null)[] = [];
  [...keep].sort((a, b) => a - b).forEach((p, i, arr) => {
    if (i && p - arr[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

