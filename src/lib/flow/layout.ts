import { CARD_ORDER, type CardId } from "./model";

export type CanvasNodeId = CardId;
export type Pos = { x: number; y: number };

/** Thứ tự các thẻ trên hàng ngang (cũng là thứ tự dây nối). */
export const MAIN_ORDER: CardId[] = CARD_ORDER;

/** Bề rộng thẻ + khoảng hở giữa hai thẻ (px trên canvas). */
export const CARD_WIDTH = 188;
export const CARD_GAP = 28;

export const DEFAULT_POSITIONS = Object.fromEntries(MAIN_ORDER.map((id, i) => [id, { x: i * (CARD_WIDTH + CARD_GAP), y: 0 }])) as Record<CanvasNodeId, Pos>;

export const LAYOUT_KEY = "flow_layout";

const isPos = (p: unknown): p is Pos =>
  typeof p === "object" && p !== null && Number.isFinite((p as Pos).x) && Number.isFinite((p as Pos).y);

/**
 * Bố cục đã lưu chỉ dùng khi đủ MỌI thẻ hiện tại với toạ độ hợp lệ. Thiếu/hỏng/của mô hình cũ
 * (id trigger, agent, node con…) thì về mặc định cả bộ — trộn vị trí cũ với mới sẽ làm hàng thẻ lộn xộn.
 */
export function mergeLayout(saved: unknown): Record<CanvasNodeId, Pos> {
  const src = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  const valid = MAIN_ORDER.every((id) => isPos(src[id]));
  if (!valid) return DEFAULT_POSITIONS;
  return Object.fromEntries(MAIN_ORDER.map((id) => [id, { x: (src[id] as Pos).x, y: (src[id] as Pos).y }])) as Record<CanvasNodeId, Pos>;
}
