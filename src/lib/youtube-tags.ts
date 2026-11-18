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

/**
 * Bộ tag cố định kênh "Chuyện Đời Lắng Đọng" — xếp điểm vidIQ cao → thấp (đo trên video #68). KHÔNG dùng bộ tu tiên
 * (#68 bị gắn "tu tiên", "xuyên không"… cho truyện người vợ).
 */
export const LIFE_FIXED_TAGS = ["audio truyện", "truyện audio", "truyện đêm khuya", "truyen audio", "audio truyện full", "chuyện đời"];

/** Tag lạc thể loại với chuyện đời (AI/vidIQ hay kéo sang từ kênh gốc). */
const OFF_LIFE = /tu tiên|tiên hiệp|tien hiep|tu tien|huyền huyễn|huyen huyen|xuyên không|xuyen khong|ma đạo|đô thị|kiếm hiệp/i;

/** YouTube đếm tag có dấu cách như có thêm 2 dấu ngoặc kép. */
export const tagCost = (t: string) => t.length + (t.includes(" ") ? 2 : 0);

/** Bộ cố định trước, rồi tag AI (bỏ trùng không phân biệt hoa thường), dừng trước khi vượt 500 ký tự. */
export function cleanTags(tags: string[], life = false) {
  const out: string[] = [];
  const seen = new Set<string>();
  let used = 0;
  // Chuyện đời: bỏ tag lạc thể loại và tag dài như nguyên tiêu đề (vidIQ chấm 24 — không ai tìm cả câu đó).
  const own = life ? tags.filter((t) => !OFF_LIFE.test(t) && t.trim().split(/\s+/).length <= 6) : tags;
  for (const raw of [...(life ? LIFE_FIXED_TAGS : FIXED_TAGS), ...own]) {
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

/** Điểm vidIQ thật (overall 0–100) của bộ tag cố định — chép từ YouTube Studio có vidIQ của chủ kênh, 12/11/2026. Không tốn credit. */
export const FIXED_TAG_SCORES: Record<string, number> = {
  "audio tiên hiệp": 74,
  "tiên hiệp audio": 72,
  "truyện audio": 78,
  "truyện audio tu tiên": 64,
  "truyện tiên hiệp": 68,
  "truyện tiên hiệp audio": 69,
  "truyện tiên hiệp hay": 61,
  "truyện tu tiên": 71,
  "truyện tu tiên audio": 63,
  "truyện đêm khuya": 66,
  "tu tiên": 70,
  "truyen tien hiep audio": 67,
  "truyen audio": 67,
  "truyện audio huyền huyễn": 66,
  "xuyên không": 74,
  "truyện audio tiên hiệp": 67,
  "huyền huyễn": 65,
  "audio truyện": 79,
  "audio truyện tu tiên": 62,
  "audio truyện full": 64,
  "chuyện đời": 60,
};
