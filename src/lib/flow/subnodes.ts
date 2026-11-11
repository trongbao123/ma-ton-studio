import type { BrandId } from "@/components/brand-icons";
import { describeRoute, firstUsableRoute, imageBrand, musicTitle } from "./derive";
import { formatTime, type CardId, type CardView, type FlowData } from "./model";

/** Khóa icon nét (STEP_ICONS) cho node con không có logo hãng. */
export type SubIcon = "model" | "bible" | "summary" | "vidiq" | "music" | "label" | "calendar" | "tts" | "images" | "video" | "voice" | "list";

/** Node con xếp cột bên phải thẻ cha như cổng chat model / memory / tool của n8n: `value` là model hoặc giá trị thật. */
export type SubView = {
  id: string;
  parent: CardId;
  label: string;
  value: string;
  icon: SubIcon;
  brand?: BrandId | null;
  /** false = chưa có dữ liệu → hiện mờ. */
  ok: boolean;
};

export const SUB_WIDTH = 176;
export const SUB_HEIGHT = 46;
export const SUB_GAP = 14;
/** Khoảng hở giữa mép phải thẻ cha và cột node con (px trên canvas). */
export const SUB_INSET = 48;
const SUB_TOP = 8;

/** Chiều cao ước của thẻ cha (thẻ tự co theo nội dung) — chỉ để đặt node con dưới thẻ ở chế độ ngang. */
const CARD_EST_HEIGHT = 150;
/** Khoảng hở giữa mép dưới thẻ cha và cột node con (chế độ ngang). */
const SUB_DROP = 44;

/** Node con chế độ ngang: vòng tròn + nhãn bên dưới (kiểu n8n), xếp thành hàng ngang dưới thẻ cha. */
export const SUB_WIDTH_H = 92;
export const SUB_HEIGHT_H = 84;
const SUB_GAP_H = 10;

/**
 * Vị trí (tương đối so với thẻ cha) của node con thứ i trong `count` node con. Dọc: cột bên phải thẻ cha.
 * Ngang: một hàng ngang ngay dưới thẻ cha, canh giữa thẻ (kiểu n8n Model · Memory · Tool).
 */
export function subOffset(index: number, parentWidth: number, horizontal = false, count = 1): { x: number; y: number } {
  if (horizontal) {
    const row = count * SUB_WIDTH_H + (count - 1) * SUB_GAP_H;
    return { x: (parentWidth - row) / 2 + index * (SUB_WIDTH_H + SUB_GAP_H), y: CARD_EST_HEIGHT + SUB_DROP };
  }
  return { x: parentWidth + SUB_INSET, y: SUB_TOP + index * (SUB_HEIGHT + SUB_GAP) };
}

const orDash = (s: string | null | undefined) => (s && s.trim() ? s : "—");

type ModelTag = { label: string; brand: BrandId | null };

/** AI đầu chuỗi (đã cấu hình) của một việc chữ; chưa cấu hình → null. */
function textModel(d: FlowData, task: "meta" | "scenes"): ModelTag | null {
  const route = firstUsableRoute(d.ai.text?.[task] ?? [], d.ai.available ?? []);
  return route ? describeRoute(route) : null;
}

const modelSub = (id: string, parent: CardId, label: string, tag: ModelTag | null): SubView => ({
  id,
  parent,
  label,
  value: orDash(tag?.label),
  icon: "model",
  brand: tag?.brand ?? null,
  ok: Boolean(tag),
});

/** Model vẽ ảnh thật (hoặc dự kiến) — dùng chung cho Ảnh cảnh, Thumbnail và Short. */
const drawSub = (id: string, parent: CardId, label: string, d: FlowData): SubView => {
  const { model, source } = d.ai.image;
  return { id, parent, label, value: orDash(model), icon: "images", brand: imageBrand(model), ok: Boolean(model) && source !== "configured" };
};

/**
 * Các node con của từng thẻ, suy từ dữ liệu thật; thiếu dữ liệu thì `ok=false` + "—", không bịa.
 * Bản gộp dùng lại chương / giọng / ảnh nên không có node con ở Viết chương, Giọng đọc, Ảnh cảnh.
 */
export function buildSubs(d: FlowData, cards: Record<CardId, CardView>): SubView[] {
  const reuse = Boolean(d.video.meta?.compilation);
  const m = d.video.meta;
  const subs: SubView[] = [];

  const scannedAt = d.trends?.scannedAt;
  subs.push(
    { id: "trends-vidiq", parent: "trends", label: "vidIQ", value: scannedAt ? formatTime(scannedAt) : "—", icon: "vidiq", ok: Boolean(scannedAt) },
    modelSub("trends-model", "trends", "Chat model", textModel(d, "meta")),
  );

  if (!reuse) {
    const chat = cards.chapter.ai;
    subs.push(
      { id: "chapter-model", parent: "chapter", label: "Chat model", value: orDash(chat?.label), icon: "model", brand: chat?.brand ?? null, ok: Boolean(chat) },
      { id: "chapter-bible", parent: "chapter", label: "Memory", value: "Story bible", icon: "bible", ok: Boolean(d.series.bibleExcerpt) },
      { id: "chapter-summary", parent: "chapter", label: "Tóm tắt", value: "chương trước", icon: "summary", ok: Boolean(d.prevSummary) },
    );
  }

  // Video cũ chưa ghi model thật → hiện AI đầu chuỗi đang cấu hình cho tiêu đề / mô tả.
  const titleScore = m?.seo?.titleScore;
  const keywords = m?.seo?.keywords?.length ?? 0;
  const vidiq = titleScore != null ? `${titleScore}đ` : keywords ? `${keywords} từ khóa` : "—";
  subs.push(
    modelSub("seo-model", "seo", "Chat model", cards.seo.ai ?? textModel(d, "meta")),
    { id: "seo-vidiq", parent: "seo", label: "vidIQ", value: vidiq, icon: "vidiq", ok: titleScore != null || keywords > 0 },
  );

  if (!reuse) {
    const voice = d.series.ttsVoice;
    subs.push(
      { id: "tts-model", parent: "tts", label: "TTS model", value: d.video.progress?.steps.tts?.model || "Gemini TTS", icon: "tts", brand: "gemini", ok: Boolean(d.video.durationSec) },
      { id: "tts-voice", parent: "tts", label: "Giọng", value: orDash(voice), icon: "voice", ok: Boolean(voice) },
      drawSub("images-model", "images", "AI vẽ ảnh", d),
      modelSub("images-prompt", "images", "Prompt cảnh", textModel(d, "scenes")),
    );
  }
  if (!reuse) {
    const i2v = d.video.progress?.i2v;
    subs.push(
      { id: "i2v-model", parent: "i2v", label: "Model", value: orDash(i2v?.model), icon: "model", brand: null, ok: Boolean(i2v?.model) },
      { id: "i2v-gpu", parent: "i2v", label: "GPU", value: i2v?.gpu ? `${i2v.gpu}${i2v.gpuMinutes ? ` · ${i2v.gpuMinutes}p` : ""}` : "—", icon: "video", ok: Boolean(i2v?.gpu) },
    );
  }
  subs.push(drawSub("thumbnail-model", "thumbnail", "AI vẽ ảnh", d));

  const music = m ? musicTitle(m.description) : null;
  subs.push(
    { id: "video-music", parent: "video", label: "Nhạc nền", value: orDash(music), icon: "music", ok: Boolean(music) },
    { id: "video-ffmpeg", parent: "video", label: "ffmpeg", value: "1080p", icon: "video", ok: true },
  );

  if (d.series.makeShort) {
    const voice = d.series.ttsVoice;
    subs.push({ id: "short-voice", parent: "short", label: "Giọng", value: orDash(voice), icon: "voice", ok: Boolean(voice) }, drawSub("short-model", "short", "AI vẽ", d));
  }

  subs.push(
    { id: "youtube-label", parent: "youtube", label: "Nhãn AI", value: "Có", icon: "label", ok: true },
    { id: "youtube-slot", parent: "youtube", label: "Lịch đăng", value: d.video.publishAt ? formatTime(d.video.publishAt) : "—", icon: "calendar", ok: Boolean(d.video.publishAt) },
    { id: "youtube-playlist", parent: "youtube", label: "Danh sách phát", value: d.youtube.playlistId ? "Có" : "—", icon: "list", ok: Boolean(d.youtube.playlistId) },
  );
  return subs;
}
