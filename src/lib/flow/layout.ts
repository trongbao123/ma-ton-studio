import { CARD_ORDER, type CardId } from "./model";

export type CanvasNodeId = CardId;
export type Pos = { x: number; y: number };

/** Thứ tự các thẻ trên hàng ngang (cũng là thứ tự dây nối). */
export const MAIN_ORDER: CardId[] = CARD_ORDER;

/** Bề rộng thẻ + khoảng hở giữa hai thẻ (px trên canvas). */
export const CARD_WIDTH = 248;
export const CARD_GAP = 56;
/** Toạ độ y chung của cả hàng. */
export const ROW_Y = 0;

export const DEFAULT_POSITIONS = Object.fromEntries(MAIN_ORDER.map((id, i) => [id, { x: i * (CARD_WIDTH + CARD_GAP), y: ROW_Y }])) as Record<CanvasNodeId, Pos>;

export const LAYOUT_KEY = "flow_layout";

const isPos = (p: unknown): p is Pos =>
  typeof p === "object" && p !== null && Number.isFinite((p as Pos).x) && Number.isFinite((p as Pos).y);

/**
 * Bố cục đã lưu chỉ dùng khi đủ MỌI thẻ, toạ độ hợp lệ, cùng một hàng ngang (cùng y) và không chồng nhau.
 * Thiếu/hỏng/lệch hàng/của mô hình cũ (thẻ hẹp hơn, zigzag, id trigger…) thì về mặc định cả bộ.
 */
export function mergeLayout(saved: unknown): Record<CanvasNodeId, Pos> {
  const src = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  if (!MAIN_ORDER.every((id) => isPos(src[id]))) return DEFAULT_POSITIONS;
  const row = MAIN_ORDER.map((id) => src[id] as Pos);
  const sameRow = row.every((p) => p.y === row[0].y);
  const ordered = row.every((p, i) => i === 0 || p.x - row[i - 1].x >= CARD_WIDTH);
  if (!sameRow || !ordered) return DEFAULT_POSITIONS;
  return Object.fromEntries(MAIN_ORDER.map((id, i) => [id, { x: row[i].x, y: row[i].y }])) as Record<CanvasNodeId, Pos>;
}
