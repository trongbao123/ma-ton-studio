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

/**
 * So khớp GIỮ DẤU (chỉ bỏ hoa/thường, dấu câu) — như vidIQ: tag "truyen tu tien" KHÔNG khớp "Truyện tu tiên"
 * trong tiêu đề/mô tả, và không trùng từ khóa người ta tìm. Trước đây bỏ dấu nên app chấm cao hơn vidIQ.
 */
export function key(s: string) {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

const has = (text: string, phrase: string) => {
  const p = key(phrase);
  return p.length > 0 && ` ${key(text)} `.includes(` ${p} `);
};
const hasLoose = (text: string, phrase: string) => {
  const p = norm(phrase);
  return p.length > 0 && ` ${norm(text)} `.includes(` ${p} `);
};
const count = (text: string, phrase: string) => {
  const p = key(phrase);
  if (!p) return 0;
  return ` ${key(text)} `.split(` ${p} `).length - 1;
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

export function scoreTitle(title: string, keywords: string[], tags: string[], vidiq?: number | null, search: string[] = []): SeoScore {
  const len = [...title].length;
  const kw = keywords.find((k) => has(title, k));
  const head = kw ? key(title).indexOf(key(kw)) <= key(title).length * 0.4 : false;
  const tagHit = tags.filter((t) => !keywords.some((k) => key(k) === key(t)) && has(title, t)).length;
  const checks = [
    check(len >= 40 && len <= 70, `Độ dài ${len} ký tự (đẹp nhất 40–70, không bị cắt trên điện thoại)`, 25, len >= 30 && len <= 90 ? 15 : 5),
    check(!!kw, kw ? `Có từ khóa chính "${kw}"` : "Thiếu tên truyện / từ khóa chính", 25),
    check(head, "Từ khóa chính nằm ở đầu tiêu đề", 10),
    check(/(chương|chuong|tập|tap|ep)\s*\d+/i.test(title), "Có số chương / tập", 10),
    check(tagHit > 0, tagHit ? `Trùng ${tagHit} tag phụ (tăng liên quan)` : "Không chứa tag phụ nào", 15),
    check(!isCaps(title), "Không in hoa toàn bộ", 5),
    check(len <= 100, "Trong giới hạn 100 ký tự của YouTube", 10),
  ];
  // Có dữ liệu vidIQ: tiêu đề phải chứa ít nhất 1 từ khóa người ta tìm thật (tên truyện tự đặt không ai tìm).
  if (search.length) {
    const hit = search.find((k) => has(title, k));
    checks.push(check(!!hit, hit ? `Có từ khóa tìm kiếm thật "${hit}" (vidIQ)` : `Thiếu từ khóa tìm kiếm thật — nên có "${search[0]}"`, 30));
  }
  const app = tally(checks);
  // Có điểm vidIQ (CTR thật) thì lấy luôn điểm đó: tiêu đề giật tít cố ý bỏ từ khóa/số tập (15/11/2026, ưu tiên lượt bấm),
  // từ khóa tìm kiếm nằm ở mô tả + tag. Bảng kiểm bên dưới vẫn hiện để tham khảo.
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

export function scoreTags(tags: string[], keywords: string[], title: string, description: string, search: string[] = []): SeoScore {
  const n = tags.length;
  // Đếm như YouTube: tag có dấu cách tính thêm 2 (dấu ngoặc kép), cộng dấu phẩy ngăn cách.
  const chars = tags.reduce((n, t, i) => n + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0), 0);
  const firstKw = n > 0 && keywords.some((k) => key(tags[0]).includes(key(k)) || key(k).includes(key(tags[0])));
  const anyKw = tags.some((t) => keywords.some((k) => key(t).includes(key(k))));
  const relevant = n ? tags.filter((t) => has(`${title}\n${description}`, t)).length / n : 0;
  const lens = tags.map((t) => words(t));
  const mixed = lens.some((l) => l <= 2) && lens.some((l) => l >= 3);
  const dup = n - new Set(tags.map(norm)).size;
  const checks = [
    check(n >= 10 && n <= 25, `${n} tag (nên 10–25)`, 20, n >= 5 ? 10 : 0),
    check(chars >= 300 && chars <= 500, `${chars}/500 ký tự (nên dùng 300–500, quá 500 YouTube cắt bớt)`, 20, chars > 500 ? 8 : chars >= 200 ? 12 : 5),
    check(firstKw, "Tag đầu tiên là từ khóa chính", 15, anyKw ? 7 : 0),
    check(relevant >= 0.4, `${Math.round(relevant * 100)}% tag khớp tiêu đề/mô tả (nên ≥ 40%)`, 25, Math.round((relevant / 0.4) * 25)),
    check(mixed, "Có cả tag ngắn và tag dài (long-tail)", 10),
    check(dup === 0, dup ? `${dup} tag trùng nhau` : "Không trùng tag", 10),
  ];
  // Tag viết không dấu của cụm có dấu trong tiêu đề/mô tả/từ khóa ("truyen audio" thay vì "truyện audio"): vidIQ coi là tag lạ, không lượt tìm.
  const ctx = [title, description, ...search].join("\n");
  const unaccented = tags.filter((t) => !has(ctx, t) && hasLoose(ctx, t));
  checks.push(check(unaccented.length === 0, unaccented.length ? `${unaccented.length} tag viết không dấu (vd "${unaccented[0]}") — viết có dấu đúng như người ta gõ` : "Tag viết có dấu", 20));
  if (search.length) {
    const hits = tags.filter((t) => search.some((k) => key(k) === key(t))).length;
    checks.push(check(hits >= 5, `${hits} tag trùng y từ khóa người ta tìm thật (vidIQ, nên ≥ 5)`, 20, hits * 4));
  }
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
  const search = m.seo?.keywords ?? [];
  // Từ khóa tìm kiếm thật đứng trước tên truyện → tag đầu / đoạn đầu mô tả ưu tiên từ khóa có lượt tìm.
  const kw = [...search.slice(0, 5), ...focusKeywords(seriesTitle)];
  return {
    title: scoreTitle(m.title, kw, m.tags, m.seo?.titleScore, search.slice(0, 8)),
    description: scoreDescription(m.description, kw, m.tags),
    tags: scoreTags(m.tags, kw, m.title, m.description, search.slice(0, 20)),
    short: scoreShort(m.shortTitle, m.shortDescription, kw),
  };
}

/** Điểm tổng tối thiểu — dưới mức này pipeline tự chạy magic fill, bảng hiện nút. */
export const SEO_TARGET = 90;

/**
 * Điểm tổng = trung bình tiêu đề / mô tả / tag — đúng 3 mục vidIQ chấm cho video dài.
 * Short chấm riêng, không cộng vào (trước đây Short dễ được 100 nên đẩy điểm tổng cao hơn vidIQ).
 */
export function totalScore(s: ReturnType<typeof scoreMeta>) {
  const parts = [s.title, s.description, s.tags];
  return Math.round(parts.reduce((n, p) => n + p.score, 0) / parts.length);
}

/** Các tiêu chí còn mất điểm, theo từng mục — đưa cho AI sửa. */
export function seoFeedback(s: ReturnType<typeof scoreMeta>) {
  const names = { title: "Tiêu đề", description: "Mô tả", tags: "Tag", short: "Short" } as const;
  return (Object.keys(names) as (keyof typeof names)[])
    .map((k) => {
      const miss = s[k].checks.filter((c) => !c.ok);
      return miss.length ? `${names[k]} (${s[k].score}/100):\n${miss.map((c) => `- ${c.text}`).join("\n")}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}
