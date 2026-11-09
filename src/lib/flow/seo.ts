import type { VideoMeta } from "@/db/schema";

/**
 * Điểm SEO 0–100 cho tiêu đề / mô tả / tag / Short, chấm ngay trong app theo checklist kiểu vidIQ
 * (không tốn credit, video cũ cũng có điểm). Tiêu đề có điểm vidIQ thật (meta.seo.titleScore) thì ưu tiên điểm đó.
 */
export type Check = { ok: boolean; text: string; points: number; max: number };
export type SeoScore = { score: number; source: "vidiq" | "app"; checks: Check[] };

/** Bỏ dấu, chữ thường, chỉ giữ chữ-số — để "Thần Ma Táng Cổ" khớp tag "than ma tang co". */
export function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

const has = (text: string, phrase: string) => {
  const p = norm(phrase);
  return p.length > 0 && ` ${norm(text)} `.includes(` ${p} `);
};
const count = (text: string, phrase: string) => {
  const p = norm(phrase);
  if (!p) return 0;
  return ` ${norm(text)} `.split(` ${p} `).length - 1;
};

/** Tên truyện "Thần Ma Táng Cổ: Thôn Thiên Lục" → ["Thần Ma Táng Cổ", "Thôn Thiên Lục"]. */
export function focusKeywords(seriesTitle: string) {
  return seriesTitle
    .split(/[:\-–—|]/)
    .map((s) => s.trim())
    .filter((s) => norm(s).length >= 3);
}

function tally(checks: Check[], source: SeoScore["source"] = "app"): SeoScore {
  const max = checks.reduce((n, c) => n + c.max, 0);
  const got = checks.reduce((n, c) => n + c.points, 0);
  return { score: max ? Math.round((got / max) * 100) : 0, source, checks };
}

const check = (ok: boolean, text: string, max: number, partial?: number): Check => ({
  ok,
  text,
  max,
  points: ok ? max : Math.max(0, Math.min(max, partial ?? 0)),
});

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const isCaps = (s: string) => {
  const letters = s.replace(/[^\p{L}]/gu, "");
  return letters.length > 8 && letters === letters.toUpperCase();
};

export function scoreTitle(title: string, keywords: string[], tags: string[], vidiq?: number | null): SeoScore {
  const len = [...title].length;
  const kw = keywords.find((k) => has(title, k));
  const head = kw ? norm(title).indexOf(norm(kw)) <= norm(title).length * 0.4 : false;
  const tagHit = tags.filter((t) => !keywords.some((k) => norm(k) === norm(t)) && has(title, t)).length;
  const checks = [
    check(len >= 40 && len <= 70, `Độ dài ${len} ký tự (đẹp nhất 40–70, không bị cắt trên điện thoại)`, 25, len >= 30 && len <= 90 ? 15 : 5),
    check(!!kw, kw ? `Có từ khóa chính "${kw}"` : "Thiếu tên truyện / từ khóa chính", 25),
    check(head, "Từ khóa chính nằm ở đầu tiêu đề", 10),
    check(/(chương|chuong|tập|tap|ep)\s*\d+/i.test(title), "Có số chương / tập", 10),
    check(tagHit > 0, tagHit ? `Trùng ${tagHit} tag phụ (tăng liên quan)` : "Không chứa tag phụ nào", 15),
    check(!isCaps(title), "Không in hoa toàn bộ", 5),
    check(len <= 100, "Trong giới hạn 100 ký tự của YouTube", 10),
  ];
  const app = tally(checks);
  return vidiq != null ? { ...app, score: Math.round(vidiq), source: "vidiq" } : app;
}

export function scoreDescription(description: string, keywords: string[], tags: string[]): SeoScore {
  const w = words(description);
  const first = description.slice(0, 150);
  const kwHead = keywords.some((k) => has(first, k));
  const kwTimes = Math.max(0, ...keywords.map((k) => count(description, k)));
  const tagIn = tags.length ? tags.filter((t) => has(description, t)).length / tags.length : 0;
  const hashtags = (description.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const paras = description.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const checks = [
    check(w >= 200, `${w} từ (nên từ 200 trở lên)`, 25, w >= 100 ? 15 : w >= 50 ? 8 : 0),
    check(kwHead, "Từ khóa chính trong 150 ký tự đầu (hiện trên kết quả tìm kiếm)", 20),
    check(kwTimes >= 2, `Từ khóa chính lặp ${kwTimes} lần (nên ≥ 2)`, 10, kwTimes === 1 ? 5 : 0),
    check(tagIn >= 0.3, `${Math.round(tagIn * 100)}% tag xuất hiện trong mô tả (nên ≥ 30%)`, 20, Math.round((tagIn / 0.3) * 20)),
    check(/đăng ký|dang ky|subscribe|like|chuông|chuong/i.test(description), "Có kêu gọi đăng ký / like", 10),
    check(hashtags >= 2 && hashtags <= 15, `${hashtags} hashtag (nên 2–15)`, 10, hashtags === 1 ? 5 : 0),
    check(paras >= 2, "Chia đoạn dễ đọc", 5),
  ];
  return tally(checks);
}

export function scoreTags(tags: string[], keywords: string[], title: string, description: string): SeoScore {
  const n = tags.length;
  const chars = tags.join(",").length;
  const firstKw = n > 0 && keywords.some((k) => norm(tags[0]).includes(norm(k)) || norm(k).includes(norm(tags[0])));
  const anyKw = tags.some((t) => keywords.some((k) => norm(t).includes(norm(k))));
  const relevant = n ? tags.filter((t) => has(`${title}\n${description}`, t)).length / n : 0;
  const lens = tags.map((t) => words(t));
  const mixed = lens.some((l) => l <= 2) && lens.some((l) => l >= 3);
  const dup = n - new Set(tags.map(norm)).size;
  const checks = [
    check(n >= 10 && n <= 25, `${n} tag (nên 10–25)`, 20, n >= 5 ? 10 : 0),
    check(chars >= 300 && chars <= 500, `${chars}/500 ký tự (nên dùng 300–500)`, 20, chars > 500 ? 0 : chars >= 200 ? 12 : 5),
    check(firstKw, "Tag đầu tiên là từ khóa chính", 15, anyKw ? 7 : 0),
    check(relevant >= 0.4, `${Math.round(relevant * 100)}% tag khớp tiêu đề/mô tả (nên ≥ 40%)`, 25, Math.round((relevant / 0.4) * 25)),
    check(mixed, "Có cả tag ngắn và tag dài (long-tail)", 10),
    check(dup === 0, dup ? `${dup} tag trùng nhau` : "Không trùng tag", 10),
  ];
  return tally(checks);
}

export function scoreShort(shortTitle: string, shortDescription: string, keywords: string[]): SeoScore {
  const len = [...shortTitle].length;
  const text = `${shortTitle}\n${shortDescription}`;
  const checks = [
    check(/#shorts\b/i.test(text), "Có #shorts", 30),
    check(len <= 60, `Tiêu đề ${len} ký tự (Short nên ≤ 60)`, 25, len <= 80 ? 15 : 0),
    check(keywords.some((k) => has(text, k)), "Nhắc tên truyện / từ khóa chính", 25),
    check(shortDescription.trim().length >= 20, "Có mô tả Short", 20),
  ];
  return tally(checks);
}

export function scoreMeta(m: VideoMeta, seriesTitle: string) {
  const kw = focusKeywords(seriesTitle);
  return {
    title: scoreTitle(m.title, kw, m.tags, m.seo?.titleScore),
    description: scoreDescription(m.description, kw, m.tags),
    tags: scoreTags(m.tags, kw, m.title, m.description),
    short: scoreShort(m.shortTitle, m.shortDescription, kw),
  };
}
