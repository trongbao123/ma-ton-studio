import type { BrandId } from "@/components/brand-icons";
import { describeRoute, firstUsableRoute, imageBrand, musicTitle } from "./derive";
import { formatTime, type CardId, type CardView, type FlowData } from "./model";

/** Khóa icon nét (STEP_ICONS) cho node con không có logo hãng. */
export type SubIcon = "model" | "bible" | "summary" | "vidiq" | "music" | "label" | "calendar";

/** Node con treo dưới thẻ cha như cổng chat model / memory / tool của n8n: `value` là model hoặc giá trị thật. */
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

export const SUB_WIDTH = 104;
export const SUB_GAP = 12;
/** Khoảng cách dọc từ đỉnh hàng chính tới đỉnh hàng node con (px trên canvas). */
export const SUB_Y = 430;

/** Toạ độ x (tương đối so với thẻ cha) của node con thứ i trong n node, canh giữa dưới thẻ cha. */
export function subOffsetX(index: number, count: number, parentWidth: number): number {
  const total = count * SUB_WIDTH + (count - 1) * SUB_GAP;
  return (parentWidth - total) / 2 + index * (SUB_WIDTH + SUB_GAP);
}

const orDash = (s: string | null | undefined) => (s && s.trim() ? s : "—");

/**
 * Các node con của từng thẻ, suy từ dữ liệu thật. Bản gộp dùng lại chương/ảnh nên không có node con ở Viết chương và Ảnh cảnh.
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

  if (!reuse) subs.push({ id: "images-model", parent: "images", label: "AI vẽ ảnh", value: d.ai.image.model, icon: "model", brand: imageBrand(d.ai.image.model), ok: true });

  const music = m ? musicTitle(m.description) : null;
  subs.push({ id: "video-music", parent: "video", label: "Nhạc nền", value: orDash(music), icon: "music", ok: Boolean(music) });

  subs.push(
    { id: "youtube-label", parent: "youtube", label: "Nhãn AI", value: "Có", icon: "label", ok: true },
    { id: "youtube-slot", parent: "youtube", label: "Lịch đăng", value: d.video.publishAt ? formatTime(d.video.publishAt) : "—", icon: "calendar", ok: Boolean(d.video.publishAt) },
  );
  return subs;
}
