/**
 * Bộ tag CỐ ĐỊNH chủ kênh chọn (điểm vidIQ 61–79) — luôn gắn cho MỌI video, đứng đầu theo đúng thứ tự này;
 * tag AI viết riêng từng video (tên truyện, nhân vật…) chỉ lấp phần còn lại của giới hạn 500 ký tự.
 */
export const FIXED_TAGS = [
  "audio tiên hiệp",
  "tiên hiệp audio",
  "truyện audio",
  "truyện audio tu tiên",
  "truyện tiên hiệp",
  "truyện tiên hiệp audio",
  "truyện tiên hiệp hay",
  "truyện tu tiên",
  "truyện tu tiên audio",
  "truyện đêm khuya",
  "tu tiên",
  "truyen tien hiep audio",
  "truyen audio",
  "truyện audio huyền huyễn",
  "xuyên không",
  "truyện audio tiên hiệp",
  "huyền huyễn",
  "audio truyện",
  "audio truyện tu tiên",
  "audio truyện full",
];

/** YouTube đếm tag có dấu cách như có thêm 2 dấu ngoặc kép. */
export const tagCost = (t: string) => t.length + (t.includes(" ") ? 2 : 0);

/** Bộ cố định trước, rồi tag AI (bỏ trùng không phân biệt hoa thường), dừng trước khi vượt 500 ký tự. */
export function cleanTags(tags: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const raw of [...FIXED_TAGS, ...tags]) {
    const t = raw.replace(/[<>,]/g, "").trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    const cost = tagCost(t) + (out.length ? 1 : 0);
    if (used + cost > 500) break;
    out.push(t);
    seen.add(key);
    used += cost;
  }
  return out;
}
