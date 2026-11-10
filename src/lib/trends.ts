import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Khoá app_settings lưu kết quả quét xu hướng YouTube. */
export const TRENDS_KEY = "trends";
/** Insight quá hạn này thì không đưa vào dàn ý / SEO nữa. */
export const INSIGHT_MAX_AGE_DAYS = 7;
/** Phần xu hướng chèn vào prompt dàn ý không vượt quá số ký tự này. */
export const BRIEF_MAX_CHARS = 1200;

export const insightsSchema = z.object({
  summary: z.string().describe("Tóm tắt 3–5 câu: ngách đang chuộng gì, vì sao"),
  hotTopics: z.array(z.object({ topic: z.string(), why: z.string(), evidence: z.string().describe("Bằng chứng ngắn từ dữ liệu: tên video, số view…") })),
  titlePatterns: z.array(z.string()).describe("Mẫu tiêu đề đang ăn view, kèm ví dụ ngắn"),
  thumbnailPatterns: z.array(z.string()).describe("Mẫu thumbnail đang ăn view: bố cục, màu, chữ, nhân vật"),
  hooks: z.array(z.string()).describe("Mô-típ mở truyện / móc câu gây tò mò đang hút khán giả"),
  audienceWants: z.array(z.string()).describe("Khán giả muốn gì (từ câu hỏi, bình luận)"),
  risingKeywords: z.array(z.object({ keyword: z.string(), note: z.string() })),
  actions: z.array(z.string()).describe("Việc cụ thể nên làm cho kênh để tăng view và RPM"),
});
export type TrendInsights = z.infer<typeof insightsSchema>;

export type TrendVideo = {
  title: string;
  channel: string | null;
  views: number | null;
  /** Lượt xem/giờ (trending) hoặc điểm outlier — vidIQ trả cái nào ghi cái đó. */
  vph: number | null;
  outlierScore: number | null;
  publishedAt: string | null;
  /** Thời lượng (giây) — ngách truyện audio, độ dài là tín hiệu quan trọng (FULL 6H…). */
  durationSec?: number | null;
  url: string | null;
  thumbnail: string | null;
};

export type TrendsData = {
  scannedAt: string;
  raw: { trending: TrendVideo[]; outliers: TrendVideo[] };
  insights: TrendInsights | null;
};

export async function loadTrends(): Promise<TrendsData | null> {
  if (!process.env.DATABASE_URL) return null;
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, TRENDS_KEY)).catch(() => []);
  return (row?.value as TrendsData | undefined) ?? null;
}

export async function saveTrends(value: TrendsData) {
  await db()
    .insert(appSettings)
    .values({ key: TRENDS_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

const DAY_MS = 86_400_000;

/** Đã quét trong vòng `days` ngày chưa (scannedAt hỏng thì coi như chưa). */
export function scannedWithin(data: TrendsData | null, days: number, now = Date.now()) {
  const t = data ? Date.parse(data.scannedAt) : NaN;
  return Number.isFinite(t) && now - t < days * DAY_MS;
}

/** Insight còn hạn (quét trong 7 ngày) hoặc null. */
export function freshInsights(data: TrendsData | null, now = Date.now()): TrendInsights | null {
  return data?.insights && scannedWithin(data, INSIGHT_MAX_AGE_DAYS, now) ? data.insights : null;
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * Đoạn xu hướng gọn cho prompt dàn ý: hotTopics, hooks, titlePatterns, audienceWants.
 * Cắt từng mục theo thứ tự ưu tiên để tổng không quá `max` ký tự. Rỗng → null.
 */
export function trendsBrief(i: TrendInsights | null, max = BRIEF_MAX_CHARS): string | null {
  if (!i) return null;
  const sections: [string, string[]][] = [
    ["Chủ đề đang hot", i.hotTopics.slice(0, 4).map((t) => `${t.topic} (${t.why})`)],
    ["Móc câu / mở truyện hút người nghe", i.hooks.slice(0, 3)],
    ["Khán giả muốn", i.audienceWants.slice(0, 3)],
    ["Mẫu tiêu đề đang ăn view", i.titlePatterns.slice(0, 3)],
  ];
  const lines: string[] = [];
  let used = 0;
  for (const [label, items] of sections) {
    const body = items.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!body.length) continue;
    const line = cut(`- ${label}: ${body.join("; ")}`, max - used);
    if (max - used < 40) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? lines.join("\n") : null;
}

/** Mẫu tiêu đề + thumbnail còn hạn cho bước viết SEO; thiếu cả hai → null. */
export type SeoTrendHints = { titlePatterns: string[]; thumbnailPatterns: string[] };
export function seoHints(i: TrendInsights | null): SeoTrendHints | null {
  if (!i || (!i.titlePatterns.length && !i.thumbnailPatterns.length)) return null;
  return { titlePatterns: i.titlePatterns.slice(0, 5), thumbnailPatterns: i.thumbnailPatterns.slice(0, 5) };
}

const fmtNum = (n: number | null) => (n == null ? "?" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));

/** Một dòng gọn mỗi video để đưa AI (cắt tiêu đề, bỏ url/thumbnail). */
export function videoLine(v: TrendVideo) {
  const parts = [`"${cut(v.title, 90)}"`, v.channel ? `kênh ${cut(v.channel, 30)}` : null, `${fmtNum(v.views)} view`];
  if (v.vph != null) parts.push(`${fmtNum(v.vph)} view/giờ`);
  if (v.durationSec) parts.push(`dài ${(v.durationSec / 3600).toFixed(1)} giờ`);
  if (v.outlierScore != null) parts.push(`outlier ${v.outlierScore}`);
  if (v.publishedAt) parts.push(v.publishedAt.slice(0, 10));
  return `- ${parts.filter(Boolean).join(", ")}`;
}

/** Gộp dữ liệu thô thành prompt: video chỉ lấy `perList` đầu, văn bản tool khác cắt `textMax` ký tự. */
export function buildTrendsPrompt(input: { trending: TrendVideo[]; outliers: TrendVideo[]; texts: { label: string; text: string }[] }, perList = 15, textMax = 2000) {
  const block = (label: string, body: string) => (body ? `## ${label}\n${body}` : "");
  return [
    block("Video đang trending (VN, 30 ngày)", input.trending.slice(0, perList).map(videoLine).join("\n")),
    block("Video outlier — view vượt xa kênh (VN, 30 ngày)", input.outliers.slice(0, perList).map(videoLine).join("\n")),
    ...input.texts.filter((t) => t.text.trim()).map((t) => block(t.label, cut(t.text.trim(), textMax))),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Lấy video từ kết quả tool vidIQ: JSON (lồng nhau) nếu có, không thì bảng markdown theo tên cột. */
export function parseVideos(text: string): TrendVideo[] {
  const out: TrendVideo[] = [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(typeof v === "string" ? v.replace(/[,\s]/g, "") : NaN);
    return Number.isFinite(n) ? n : null;
  };
  const make = (o: Record<string, unknown>): TrendVideo | null => {
    const title = str(o.title ?? o.videoTitle ?? o.name);
    if (!title) return null;
    const id = str(o.videoId ?? o.youtubeVideoId ?? o.id);
    const ch = o.channel;
    const channel = str(o.channelTitle ?? o.channelName ?? (typeof ch === "object" && ch ? (ch as Record<string, unknown>).title ?? (ch as Record<string, unknown>).name : ch));
    const urlRaw = str(o.url ?? o.videoUrl ?? o.link);
    const isId = id && /^[\w-]{11}$/.test(id);
    return {
      title,
      channel,
      views: num(o.views ?? o.viewCount ?? o.viewsCount),
      vph: num(o.vph ?? o.viewsPerHour ?? o.viewPerHour),
      outlierScore: num(o.outlierScore ?? o.outlier ?? o.score),
      publishedAt: str(o.publishedAt ?? o.videoPublishedAt ?? o.publishDate ?? o.publishedDate ?? o.published),
      durationSec: num(o.videoDuration ?? o.duration ?? o.durationSec),
      url: urlRaw?.startsWith("http") ? urlRaw : isId ? `https://www.youtube.com/watch?v=${id}` : null,
      thumbnail: str(o.thumbnail ?? o.thumbnailUrl ?? o.thumbnailURL) ?? (isId ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null),
    };
  };
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const video = make(o);
    if (video && (o.views ?? o.viewCount ?? o.viewsCount ?? o.videoId ?? o.id ?? o.url) != null) out.push(video);
    else Object.values(o).forEach(walk);
  };
  try {
    walk(JSON.parse(text));
    return out;
  } catch {
    // không phải JSON → thử bảng markdown
  }
  let cols: string[] | null = null;
  for (const line of text.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells[0] === "") cells.shift();
    if (cells.at(-1) === "") cells.pop();
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!cols) {
      cols = cells.map((c) => c.replace(/[^A-Za-z]/g, ""));
      if (!cols.some((c) => /title/i.test(c))) cols = null;
      continue;
    }
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i]]));
    const v = make(row);
    if (v) out.push(v);
  }
  return out;
}
