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
export const SUB_GAP = 6;
/** Khoảng hở giữa mép phải thẻ cha và cột node con (px trên canvas). */
export const SUB_INSET = 40;
const SUB_TOP = 8;

/** Vị trí (tương đối so với thẻ cha) của node con thứ i: xếp thành cột bên phải thẻ cha. */
export function subOffset(index: number, parentWidth: number): { x: number; y: number } {
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
