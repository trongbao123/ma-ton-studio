import { CARD_ORDER, type CardId } from "./model";

export type CanvasNodeId = CardId;
export type Pos = { x: number; y: number };

/** Thứ tự các thẻ khi duyệt cây từ trên xuống. */
export const MAIN_ORDER: CardId[] = CARD_ORDER;

/** Các hàng của cây dọc; hàng nhiều thẻ là các nhánh song song. */
export const TREE_ROWS: CardId[][] = [["trends"], ["chapter"], ["seo"], ["tts", "images", "thumbnail"], ["video"], ["long", "short"], ["youtube"]];

/** Bề rộng thẻ, khoảng hở giữa các nhánh song song và bước cách giữa hai hàng (px trên canvas). */
export const CARD_WIDTH = 248;
export const CARD_GAP = 40;
export const ROW_PITCH = 170;

/** Chỉ số hàng của thẻ — dùng để xếp lần lượt hiệu ứng xuất hiện từ trên xuống. */
export const ROW_OF = Object.fromEntries(TREE_ROWS.flatMap((row, r) => row.map((id) => [id, r]))) as Record<CardId, number>;

/** Cây mặc định: mỗi hàng canh giữa quanh x = 0 (nên cả cây đối xứng), hàng r nằm ở y = r * ROW_PITCH. */
function treePositions(): Record<CanvasNodeId, Pos> {
  const entries = TREE_ROWS.flatMap((row, r) =>
    row.map((id, i) => [id, { x: (i - (row.length - 1) / 2) * (CARD_WIDTH + CARD_GAP) - CARD_WIDTH / 2, y: r * ROW_PITCH }] as const),
  );
  return Object.fromEntries(entries) as Record<CanvasNodeId, Pos>;
}

export const DEFAULT_POSITIONS = treePositions();

export const LAYOUT_KEY = "flow_layout";

const isPos = (p: unknown): p is Pos =>
  typeof p === "object" && p !== null && Number.isFinite((p as Pos).x) && Number.isFinite((p as Pos).y);

/**
 * Bố cục đã lưu (người dùng kéo thả tự do) dùng khi đủ MỌI thẻ và toạ độ hợp lệ.
 * Thiếu/hỏng/của mô hình cũ (hàng ngang 7 thẻ, id trigger…) thì về cây mặc định cả bộ; "Sắp xếp lại" cũng về cây mặc định.
 */
export function mergeLayout(saved: unknown): Record<CanvasNodeId, Pos> {
  const src = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  if (!MAIN_ORDER.every((id) => isPos(src[id]))) return DEFAULT_POSITIONS;
  return Object.fromEntries(MAIN_ORDER.map((id) => [id, { x: (src[id] as Pos).x, y: (src[id] as Pos).y }])) as Record<CanvasNodeId, Pos>;
}
