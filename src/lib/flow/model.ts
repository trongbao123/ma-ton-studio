import { backfillStatusText } from "@/lib/short-backfill";
import type { Video, VideoMeta } from "@/db/schema";
import { brandOfModel, type BrandId } from "@/components/brand-icons";
import type { ProviderId, Route } from "@/lib/ai/routing";
import {
  describeRoute,
  firstUsableRoute,
  imageBrand,
  imageCounts,
  musicTitle,
  thousands,
  type AiTag,
  type CompilationRef,
  type ImagePick,
} from "./derive";
import { scoreMeta, SEO_TARGET, totalScore } from "./seo";
import type { StepProgress, VideoProgress } from "./progress";

export type FileName = "long.mp4" | "short.mp4" | "thumbnail.jpg" | "youtube.txt";
/** Id bước PIPELINE ghi tiến độ (videos.progress) — khác với thẻ trên màn flow (CardId). */
export type NodeId = "trigger" | "agent" | "tts" | "images" | "video" | "youtube";
export type StepState = "wait" | "run" | "done" | "error" | "skip";

/**
 * Mười thẻ xếp thành cây dọc: Xu hướng → Viết chương → SEO & Thumbnail → (Giọng đọc | Ảnh cảnh | Thumbnail)
 * → Dựng video → (Video dài | Short) → YouTube.
 */
export type CardId = "trends" | "chapter" | "seo" | "tts" | "images" | "thumbnail" | "video" | "long" | "short" | "youtube";
/** `quota`: chờ hết quota AI; `idle`: chưa có dữ liệu (Xu hướng chưa quét). */
export type CardState = StepState | "quota" | "idle";
export type CardLink = { label: string; href: string };
export type CardView = {
  id: CardId;
  title: string;
  state: CardState;
  /** Một cụm ngắn mô tả trạng thái, hiện ở đầu inspector. */
  subtitle: string;
  /** AI/model thật đã làm bước này. */
  ai: AiTag | null;
  /** 1–2 chỉ số chính. */
  metrics: string[];
  chips: string[];
  links: CardLink[];
  thumb?: string;
  warning?: string;
  /** 0–1 khi đang chạy có đếm */
  progress?: number;
  /** Id YouTube để hiện lượt xem / thích / bình luận (thẻ YouTube). */
  yt?: { longId: string | null; shortId: string | null };
};
/** Một việc đang kẹt / cần làm — hiện ở dải phía trên canvas, bấm để mở thẻ liên quan. */
export type Issue = { tone: "error" | "warn" | "info"; text: string; card: CardId };

export type TrendsView = {
  scannedAt: string;
  /** Quét trong 7 ngày — còn được đưa vào dàn ý / SEO. */
  fresh: boolean;
  summary: string;
  hotTopics: { topic: string; why: string }[];
  titlePatterns: string[];
  risingKeywords: { keyword: string; note: string }[];
};

/** Dữ liệu màn flow — ngày giờ là chuỗi ISO để truyền được từ server sang client. */
export type FlowData = {
  video: {
    id: number;
    status: Video["status"];
    error: string | null;
    runUrl: string | null;
    publishAt: string | null;
    durationSec: number | null;
    youtubeUrl: string | null;
    meta: VideoMeta | null;
    /** Tên asset → URL tải. Ngoài các file chính còn ảnh cảnh ("long-img-3.jpg") và giọng đọc ("narration.m4a"). */
    files: Partial<Record<FileName, string>> & Record<string, string>;
    createdAt: string;
    updatedAt: string;
    progress: VideoProgress;
    uploadStatus: Video["uploadStatus"];
    uploadError: string | null;
    youtubeVideoId: string | null;
    youtubeShortId: string | null;
  };
  /** `content`: toàn bộ chương để đọc ngay trên màn flow; `outline`: dàn ý (đầu vào của AI viết). */
  chapter: { id: number; number: number; title: string; words: number; content: string; outline: string; approvedAt: string };
  series: { id: number; title: string; bibleExcerpt: string; voiceStyle: string; ttsVoice: string; makeShort: boolean; autoPublish: boolean };
  prevSummary: string | null;
  youtube: { connected: boolean; channel: string | null; /** Danh sách phát YouTube của bộ truyện (app_settings yt_playlists); chưa tạo = null. */ playlistId?: string | null };
  /** Kết quả quét xu hướng gần nhất (app_settings "trends"); null = chưa quét. */
  trends: TrendsView | null;
  /** Bản gộp có chứa video chương này (nếu có). */
  compiledInto: CompilationRef | null;
  ai: {
    /** Model vẽ ảnh thật (hoặc dự kiến) của video này. */
    image: ImagePick;
    /** Chuỗi AI (theo thứ tự ưu tiên) cho từng việc chữ — đổi nhanh ngay trong bảng. */
    text?: { story: Route[]; meta: Route[]; scenes: Route[] };
    /** Hãng đã có API key. */
    available?: ProviderId[];
  };
};

export const CARD_ORDER: CardId[] = ["trends", "chapter", "seo", "tts", "images", "thumbnail", "video", "long", "short", "youtube"];

export const CARD_TITLES: Record<CardId, string> = {
  trends: "Xu hướng",
  chapter: "Viết chương",
  seo: "SEO & Thumbnail",
  tts: "Giọng đọc",
  images: "Ảnh cảnh",
  thumbnail: "Thumbnail",
  video: "Dựng video",
  long: "Video dài",
  short: "Short",
  youtube: "YouTube",
};

/** Bước pipeline ghi tiến độ cho từng thẻ (Xu hướng, Viết chương không chạy trong job render). */
export const PROGRESS_OF: Partial<Record<CardId, NodeId>> = { seo: "agent", tts: "tts", images: "images", video: "video", youtube: "youtube" };

export const CARD_STATE_TEXT: Record<CardState, string> = {
  wait: "Chờ",
  run: "Đang chạy",
  done: "Xong",
  error: "Lỗi",
  skip: "Bỏ qua",
  quota: "Chờ quota",
  idle: "Chưa quét",
};

/** Tên bước theo id pipeline — dùng cho nhật ký và thẻ video ở danh sách. */
export const TITLES: Record<NodeId, string> = {
  trigger: "Viết chương",
  agent: "SEO & Thumbnail",
  tts: "Giọng đọc",
  images: "Ảnh cảnh",
  video: "Dựng video",
  youtube: "YouTube",
};

export const STATUS_LABEL: Record<Video["status"], [string, string]> = {
  queued: ["Chờ render", "bg-zinc-700/60 text-zinc-200"],
  rendering: ["Đang render…", "bg-sky-900/70 text-sky-300"],
  ready: ["Sẵn sàng đăng", "bg-emerald-900/70 text-emerald-300"],
  failed: ["Lỗi", "bg-red-900/70 text-red-300"],
  published: ["Đã đăng", "bg-zinc-800 text-zinc-400"],
};

const RENDER_STEPS = ["agent", "tts", "images", "video"] as const;

/**
 * Video kẹt "đang render" (job bị huỷ/hết giờ giữa chừng): pipeline mới ghi tiến độ ~2s/lần nên 30 phút im lặng là kẹt;
 * video chạy bằng pipeline cũ (không có tiến độ) thì chờ 4 giờ — bằng giới hạn job daily.
 */
export function isStale(v: FlowData["video"], now = Date.now()) {
  if (v.status !== "rendering") return false;
  const quiet = now - Date.parse(v.updatedAt);
  return quiet > (Object.keys(v.progress?.steps ?? {}).length ? 30 : 240) * 60_000;
}

const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Giờ Việt Nam (UTC+7, không đổi giờ). Tự định dạng vì ICU của Node và trình duyệt ra chữ khác nhau → lỗi hydration. */
function vn(iso: string) {
  const d = new Date(Date.parse(iso) + 7 * 3600_000);
  return {
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    dm: `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`,
    wd: WEEKDAYS[d.getUTCDay()],
  };
}

/** "19:00 · T5 12/11" */
export function formatSlot(iso: string) {
  const t = vn(iso);
  return `${t.hm} · ${t.wd} ${t.dm}`;
}

/** "14:32 09/11" */
export function formatTime(iso: string) {
  const t = vn(iso);
  return `${t.hm} ${t.dm}`;
}

function clock(sec: number) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

/** Subtitle khi bước render đã xong — chỉ dựa vào dữ liệu thật đang có. */
function doneSubtitle(id: (typeof RENDER_STEPS)[number], v: FlowData["video"]) {
  switch (id) {
    case "agent":
      return v.meta ? "tiêu đề · Short · tag" : "xong";
    case "tts":
      return v.durationSec ? clock(v.durationSec) : "xong";
    case "images":
      return v.files["thumbnail.jpg"] ? "có thumbnail" : "xong";
    case "video":
      return v.files["short.mp4"] ? "dài + Short" : "chỉ video dài";
  }
}

/** "Dài 18/30 · Short 3/5" khi pipeline có đếm tiến độ. */
function progressSubtitle(p: StepProgress) {
  const parts = [p.long && `Dài ${p.long.done}/${p.long.total}`, p.short && `Short ${p.short.done}/${p.short.total}`].filter(Boolean);
  if (p.state === "error" && p.error) return "lỗi";
  return parts.length ? parts.join(" · ") : undefined;
}

type Base = { state: StepState; subtitle: string; warning?: string; progress?: number };
type RenderId = (typeof RENDER_STEPS)[number] | "youtube";

/** Trạng thái các bước pipeline (agent/tts/images/video/youtube) suy từ trạng thái video + tiến độ thật. */
function renderSteps(d: FlowData): Record<RenderId, Base> {
  const v = d.video;
  const finished = v.status === "ready" || v.status === "published";
  const steps = {} as Record<RenderId, Base>;

  for (const id of RENDER_STEPS) {
    if (finished) {
      steps[id] = { state: "done", subtitle: doneSubtitle(id, v) };
    } else if (v.status === "rendering") steps[id] = { state: "run", subtitle: "đang render" };
    else if (v.status === "failed") steps[id] = { state: "error", subtitle: "lỗi render" };
    else steps[id] = { state: "wait", subtitle: "chờ" };
  }

  // Có tiến độ thật từ pipeline thì dùng thay cho trạng thái suy ra.
  const tracked = v.progress?.steps ?? {};
  const hasProgress = Object.keys(tracked).length > 0;
  for (const id of RENDER_STEPS) {
    const p = tracked[id];
    if (p) {
      const warning = p.warning ?? steps[id].warning;
      steps[id] = { state: p.state, subtitle: progressSubtitle(p) ?? steps[id].subtitle, ...(warning ? { warning } : {}) };
      const parts = [p.long, p.short].filter((x) => x && x.total > 0) as { done: number; total: number }[];
      if (p.state === "run" && parts.length) steps[id].progress = parts.reduce((a, x) => a + x.done, 0) / parts.reduce((a, x) => a + x.total, 0);
    }
    // Bước chưa tới lượt: chờ, hoặc bỏ qua nếu render đã lỗi ở bước trước.
    else if (hasProgress && !finished) steps[id] = { state: v.status === "failed" ? "skip" : "wait", subtitle: "chưa chạy" };
  }

  if (v.uploadStatus === "uploading") steps.youtube = { state: "run", subtitle: "đang upload" };
  else if (v.uploadStatus === "scheduled")
    steps.youtube = { state: "done", subtitle: v.publishAt ? `${v.meta?.yt?.privacy === "public" ? "đã đăng" : "đã lên lịch"} · ${formatSlot(v.publishAt)}` : "đã lên lịch" };
  else if (v.uploadStatus === "failed") steps.youtube = { state: "error", subtitle: "upload lỗi", ...(v.uploadError ? { warning: v.uploadError } : {}) };
  else if (v.status === "published") steps.youtube = { state: "done", subtitle: "đã đăng" };
  else if (v.status === "failed") steps.youtube = { state: "skip", subtitle: "không đăng vì render lỗi" };
  else if (v.status === "ready") steps.youtube = { state: "wait", subtitle: v.publishAt ? `chờ đăng · ${formatSlot(v.publishAt)}` : "chờ đăng tay" };
  else steps.youtube = { state: "wait", subtitle: "chờ render xong" };
  return steps;
}

/** Video đang xếp hàng vì hết quota AI → thẻ nào đang chờ (lỗi nhắc tới ảnh thì là Ảnh cảnh, còn lại là AI chữ). */
export function quotaCard(v: Pick<FlowData["video"], "status" | "error">): CardId | null {
  if (v.status !== "queued" || !v.error || !/quota|hết lượt/i.test(v.error)) return null;
  return /ảnh|image|cloudflare|deepinfra|flux/i.test(v.error) ? "images" : "seo";
}

// Ảnh trên YouTube (đổi tay trong Studio) ưu tiên hơn ảnh app dựng.
const thumbOf = (d: FlowData) => d.video.meta?.yt?.thumb ?? d.video.files["thumbnail.jpg"];
const reuseText = (c: NonNullable<VideoMeta["compilation"]>) => `dùng lại từ chương ${c.from}–${c.to}`;

function trendsCard(d: FlowData): CardView {
  const t = d.trends;
  const base = { id: "trends" as const, title: CARD_TITLES.trends, ai: { label: "vidIQ + GPT", brand: "openai" as BrandId }, chips: [], links: [] };
  if (!t) return { ...base, state: "idle", subtitle: "chưa quét", metrics: ["Chưa quét xu hướng"] };
  const top = t.hotTopics[0]?.topic;
  return {
    ...base,
    state: "done",
    subtitle: `quét ${formatTime(t.scannedAt)}`,
    metrics: [`Quét ${formatTime(t.scannedAt)}`, top ? `Hot #1: ${top}` : "Chưa có chủ đề nóng"],
    ...(t.fresh ? {} : { warning: "Dữ liệu quá 7 ngày — không còn đưa vào dàn ý / SEO" }),
  };
}

function chapterCard(d: FlowData): CardView {
  const reuse = d.video.meta?.compilation;
  const route = firstUsableRoute(d.ai.text?.story ?? [], d.ai.available ?? []);
  const chips = [d.series.bibleExcerpt && "Story bible", d.prevSummary && "Tóm tắt chương trước"].filter(Boolean) as string[];
  const base = { id: "chapter" as const, title: CARD_TITLES.chapter, state: "done" as const, links: [] };
  if (reuse) return { ...base, subtitle: reuseText(reuse), ai: null, metrics: [reuseText(reuse)], chips: [] };
  return {
    ...base,
    subtitle: `Chương ${d.chapter.number}`,
    ai: route ? describeRoute(route) : null,
    metrics: [`${thousands(d.chapter.words)} từ`, `Chương ${d.chapter.number}`],
    chips,
  };
}

function seoCard(d: FlowData, base: Base): CardView {
  const m = d.video.meta;
  const model = d.video.progress?.steps.agent?.model;
  const total = m ? totalScore(scoreMeta(m, d.series.title)) : null;
  const title = m?.seo?.titleScore;
  return {
    id: "seo",
    title: CARD_TITLES.seo,
    ...base,
    ai: model ? { label: model, brand: brandOfModel(model) } : null,
    metrics: m ? [`SEO ${total}/100`, `Tiêu đề vidIQ ${title ?? "—"}`] : [],
    chips: (m?.seo?.keywords ?? []).slice(0, 3),
    links: [],
  };
}

function ttsCard(d: FlowData, base: Base): CardView {
  const reuse = d.video.meta?.compilation;
  const sec = d.video.durationSec;
  const common = { id: "tts" as const, title: CARD_TITLES.tts, ...base, chips: [], links: [] };
  if (reuse) return { ...common, ai: null, metrics: [reuseText(reuse)] };
  return { ...common, ai: { label: "Gemini TTS", brand: "gemini" }, metrics: [`Giọng ${d.series.ttsVoice}`, sec ? `Thời lượng ${clock(sec)}` : "Chưa có thời lượng"] };
}

function imagesCard(d: FlowData, base: Base): CardView {
  const reuse = d.video.meta?.compilation;
  const common = { id: "images" as const, title: CARD_TITLES.images, ...base, chips: [], links: [] };
  if (reuse) return { ...common, ai: null, metrics: [reuseText(reuse)] };
  const { model, source } = d.ai.image;
  const note = source === "tracked" ? undefined : source === "usage" ? "suy từ lượt dùng" : "dự kiến";
  const n = imageCounts(d.video.progress);
  return {
    ...common,
    ai: { label: model, brand: imageBrand(model), ...(note ? { note } : {}) },
    metrics: n ? [`${n.done}/${n.total} ảnh`] : [],
  };
}

function videoCard(d: FlowData, base: Base): CardView {
  const m = d.video.meta;
  const music = m ? musicTitle(m.description) : null;
  const metrics = [base.subtitle, m ? (music ? `♪ ${music}` : "Chưa có nhạc nền") : null].filter(Boolean) as string[];
  return { id: "video", title: CARD_TITLES.video, ...base, ai: null, metrics, chips: [], links: [] };
}

/** Thumbnail: có file thì xong; chưa có thì chạy theo bước Ảnh cảnh (file do bước đó tạo ra). */
function thumbnailCard(d: FlowData, imagesStep: Base): CardView {
  const file = thumbOf(d);
  const reuse = d.video.meta?.compilation;
  const common = { id: "thumbnail" as const, title: CARD_TITLES.thumbnail, ai: null, chips: [], links: [] };
  if (file) return { ...common, state: "done", subtitle: "có thumbnail", metrics: ["thumbnail.jpg"], thumb: file };
  if (reuse) return { ...common, state: "done", subtitle: reuseText(reuse), metrics: [reuseText(reuse)] };
  const finished = d.video.status === "ready" || d.video.status === "published";
  if (finished) return { ...common, state: "skip", subtitle: "không có file", metrics: [] };
  return { ...common, state: imagesStep.state, subtitle: imagesStep.subtitle, metrics: [] };
}

const countText = (c: { done: number; total: number }) => `${c.done}/${c.total} cảnh`;

/** Video dài / Short: có file thì xong; chưa có thì chạy theo bước Dựng video, kèm số cảnh đã dựng khi pipeline có đếm. */
function outputCard(kind: "long" | "short", d: FlowData, videoStep: Base): CardView {
  const file = d.video.files[kind === "long" ? "long.mp4" : "short.mp4"];
  const counts = d.video.progress?.steps.video?.[kind];
  const common = { id: kind, title: CARD_TITLES[kind], ai: null, chips: [], links: [] };
  const sec = d.video.durationSec;
  if (file) return { ...common, state: "done", subtitle: "đã dựng", metrics: [kind === "long" && sec ? `Thời lượng ${clock(sec)}` : "Đã dựng"] };
  const finished = d.video.status === "ready" || d.video.status === "published";
  if (kind === "short" && !d.series.makeShort) return { ...common, state: "skip", subtitle: "bộ truyện tắt Short", metrics: [] };
  const pending = kind === "short" ? backfillStatusText(d.video) : null;
  if (pending && !pending.final) return { ...common, state: "wait", subtitle: pending.text, metrics: [], warning: pending.text };
  if (finished) {
    const warning = kind === "short" ? { warning: pending ? `Short ${pending.text}` : "Không có Short" } : {};
    return { ...common, state: "skip", subtitle: kind === "short" ? (pending?.text ?? "không có Short") : "không có file", metrics: [], ...warning };
  }
  const progress = videoStep.state === "run" && counts && counts.total > 0 ? counts.done / counts.total : undefined;
  return {
    ...common,
    state: videoStep.state,
    subtitle: counts ? countText(counts) : videoStep.subtitle,
    metrics: counts ? [countText(counts)] : [],
    ...(progress != null ? { progress } : {}),
  };
}

const ytLink = (id: string) => `https://youtu.be/${id}`;

function youtubeCard(d: FlowData, base: Base): CardView {
  const v = d.video;
  const c = d.compiledInto;
  const links: CardLink[] = [
    ...(v.youtubeVideoId ? [{ label: "Video", href: ytLink(v.youtubeVideoId) }] : v.youtubeUrl ? [{ label: "Video", href: v.youtubeUrl }] : []),
    ...(v.youtubeShortId ? [{ label: "Short", href: ytLink(v.youtubeShortId) }] : []),
    ...(c ? [{ label: "Bản gộp", href: c.youtubeVideoId ? ytLink(c.youtubeVideoId) : `/videos/${c.id}` }] : []),
  ];
  return {
    id: "youtube",
    title: CARD_TITLES.youtube,
    ...base,
    ai: null,
    metrics: [v.publishAt ? `Lịch ${formatSlot(v.publishAt)}` : "Chưa có lịch đăng"],
    chips: c ? [`Trong bản gộp chương ${c.from}–${c.to}`] : [],
    links,
    ...(v.youtubeVideoId || v.youtubeShortId ? { yt: { longId: v.youtubeVideoId, shortId: v.youtubeShortId } } : {}),
  };
}

/** Các việc đang kẹt / cần làm, lỗi đứng trước. Rỗng = không có gì phải làm. */
function buildIssues(d: FlowData): Issue[] {
  const v = d.video;
  const m = v.meta;
  const out: Issue[] = [];
  const quota = quotaCard(v);
  const finished = v.status === "ready" || v.status === "published";
  if (v.status === "failed") out.push({ tone: "error", text: `Render lỗi: ${v.error ?? "không rõ nguyên nhân"}`, card: "video" });
  if (v.uploadStatus === "failed") out.push({ tone: "error", text: `Upload YouTube lỗi: ${v.uploadError ?? "không rõ nguyên nhân"}`, card: "youtube" });
  if (quota) out.push({ tone: "warn", text: `Chờ quota ${quota === "images" ? "ảnh" : "AI"}: ${v.error}`, card: quota });
  else if (v.status === "queued" && v.error) out.push({ tone: "info", text: `Đang chờ: ${v.error}`, card: "video" });
  if (finished && m && !musicTitle(m.description)) out.push({ tone: "warn", text: "Chưa có nhạc nền", card: "video" });
  const pendingShort = backfillStatusText(v);
  if (finished && d.series.makeShort && !v.files["short.mp4"]) out.push({ tone: "warn", text: pendingShort ? `Short: ${pendingShort.text}` : "Không có Short", card: "short" });
  if (m) {
    const total = totalScore(scoreMeta(m, d.series.title));
    if (total < SEO_TARGET) out.push({ tone: "warn", text: `Điểm SEO ${total} chưa đạt ${SEO_TARGET} — dùng Magic fill`, card: "seo" });
  }
  if (v.status === "ready" && v.uploadStatus === "none" && !v.youtubeVideoId && !d.youtube.connected)
    out.push({ tone: "info", text: "Chưa kết nối YouTube — video chờ đăng tay", card: "youtube" });
  return out;
}

/**
 * Suy 10 thẻ + danh sách việc kẹt từ dữ liệu thật của video.
 * Thẻ SEO & Thumbnail đọc tiến độ bước "agent" của pipeline; Xu hướng và Viết chương không chạy trong job render.
 */
export function buildFlow(d: FlowData): { cards: Record<CardId, CardView>; issues: Issue[] } {
  const steps = renderSteps(d);
  const cards: Record<CardId, CardView> = {
    trends: trendsCard(d),
    chapter: chapterCard(d),
    seo: seoCard(d, steps.agent),
    tts: ttsCard(d, steps.tts),
    images: imagesCard(d, steps.images),
    thumbnail: thumbnailCard(d, steps.images),
    video: videoCard(d, steps.video),
    long: outputCard("long", d, steps.video),
    short: outputCard("short", d, steps.video),
    youtube: youtubeCard(d, steps.youtube),
  };
  // Bản gộp dùng lại nội dung các chương: ba thẻ này không chạy riêng nên luôn "xong".
  const reuse = d.video.meta?.compilation;
  if (reuse)
    for (const id of ["tts", "images"] as const) cards[id] = { ...cards[id], state: "done", subtitle: reuseText(reuse), progress: undefined };
  const quota = quotaCard(d.video);
  if (quota) cards[quota] = { ...cards[quota], state: "quota", subtitle: "chờ quota" };
  return { cards, issues: buildIssues(d) };
}
