import type { BrandId } from "@/components/brand-icons";
import { describeRoute, firstUsableRoute, musicTitle } from "./derive";
import { formatTime, type CardId, type CardView, type FlowData } from "./model";

/** Khóa icon nét (STEP_ICONS) cho node con không có logo hãng. */
export type SubIcon = "model" | "bible" | "summary" | "vidiq" | "music" | "label" | "calendar";

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
export const SUB_INSET = 64;
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

/**
 * Các node con của từng thẻ, suy từ dữ liệu thật. Bản gộp dùng lại chương nên không có node con ở Viết chương; Ảnh cảnh không có node con (model đã hiện ngay trên thẻ).
 */
export function buildSubs(d: FlowData, cards: Record<CardId, CardView>): SubView[] {
  const reuse = Boolean(d.video.meta?.compilation);
  const m = d.video.meta;
  const subs: SubView[] = [];

  if (!reuse) {
    const chat = cards.chapter.ai;
    subs.push(
      { id: "chapter-model", parent: "chapter", label: "Chat model", value: orDash(chat?.label), icon: "model", brand: chat?.brand ?? null, ok: Boolean(chat) },
      { id: "chapter-bible", parent: "chapter", label: "Memory", value: "Story bible", icon: "bible", ok: Boolean(d.series.bibleExcerpt) },
      { id: "chapter-summary", parent: "chapter", label: "Tóm tắt", value: "chương trước", icon: "summary", ok: Boolean(d.prevSummary) },
    );
  }

  // Video cũ chưa ghi model thật → hiện AI đầu chuỗi đang cấu hình cho tiêu đề / mô tả.
  const route = firstUsableRoute(d.ai.text?.meta ?? [], d.ai.available ?? []);
  const agent = cards.seo.ai ?? (route ? describeRoute(route) : null);
  const titleScore = m?.seo?.titleScore;
  const keywords = m?.seo?.keywords?.length ?? 0;
  const vidiq = titleScore != null ? `${titleScore}đ` : keywords ? `${keywords} từ khóa` : "—";
  subs.push(
    { id: "seo-model", parent: "seo", label: "Chat model", value: orDash(agent?.label), icon: "model", brand: agent?.brand ?? null, ok: Boolean(agent) },
    { id: "seo-vidiq", parent: "seo", label: "vidIQ", value: vidiq, icon: "vidiq", ok: titleScore != null || keywords > 0 },
  );

  const music = m ? musicTitle(m.description) : null;
  subs.push({ id: "video-music", parent: "video", label: "Nhạc nền", value: orDash(music), icon: "music", ok: Boolean(music) });

  subs.push(
    { id: "youtube-label", parent: "youtube", label: "Nhãn AI", value: "Có", icon: "label", ok: true },
    { id: "youtube-slot", parent: "youtube", label: "Lịch đăng", value: d.video.publishAt ? formatTime(d.video.publishAt) : "—", icon: "calendar", ok: Boolean(d.video.publishAt) },
  );
  return subs;
}
