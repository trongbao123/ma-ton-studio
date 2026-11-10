/** Chia mảng thành các lô tối đa `size` phần tử (videos.list nhận tối đa 50 id/lượt). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error("size phải là số nguyên dương");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
