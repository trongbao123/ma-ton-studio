import { CARD_ORDER, type CardId } from "./model";

export type CanvasNodeId = CardId;
export type Pos = { x: number; y: number };

/** Thứ tự các thẻ khi duyệt cây từ trên xuống. */
export const MAIN_ORDER: CardId[] = CARD_ORDER;

/** Các hàng của cây dọc; hàng nhiều thẻ là các nhánh song song. */
export const TREE_ROWS: CardId[][] = [["trends"], ["chapter"], ["seo"], ["tts", "images", "thumbnail"], ["video"], ["long", "short"], ["youtube"]];

/** Bề rộng thẻ, khoảng hở giữa các nhánh song song và bước cách giữa hai hàng (px trên canvas). */
export const CARD_WIDTH = 248;
/** Dọc: khoảng hở rộng vì cột node con (pill) của thẻ nhánh nằm lọt giữa hai thẻ nhánh cạnh nhau. */
export const CARD_GAP = 250;
export const ROW_PITCH = 205;

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

/** Hướng sơ đồ: dọc (trên → dưới, mặc định) hoặc ngang (trái → phải). */
export type Orientation = "v" | "h";

/** Bố cục ngang: mỗi hàng của cây dọc thành một cột; nhánh song song xếp chồng trong cột, canh giữa quanh y = 0. */
export const COL_PITCH = CARD_WIDTH + 110;
/** Đủ chỗ cho thẻ (~150) + hàng node con dưới thẻ (44 + 84) của nhánh xếp chồng. */
export const STACK_PITCH = 300;

function treePositionsH(): Record<CanvasNodeId, Pos> {
  const entries = TREE_ROWS.flatMap((col, c) => col.map((id, i) => [id, { x: c * COL_PITCH, y: (i - (col.length - 1) / 2) * STACK_PITCH }] as const));
  return Object.fromEntries(entries) as Record<CanvasNodeId, Pos>;
}

export const DEFAULT_POSITIONS_H = treePositionsH();
export const defaultPositions = (o: Orientation) => (o === "h" ? DEFAULT_POSITIONS_H : DEFAULT_POSITIONS);

export const LAYOUT_KEY = "flow_layout";
/** Bố cục kéo thả của chế độ ngang lưu riêng — không đè bố cục dọc. */
export const LAYOUT_KEY_H = "flow_layout_h";
export const layoutKey = (o: Orientation) => (o === "h" ? LAYOUT_KEY_H : LAYOUT_KEY);

const isPos = (p: unknown): p is Pos =>
  typeof p === "object" && p !== null && Number.isFinite((p as Pos).x) && Number.isFinite((p as Pos).y);

/**
 * Bố cục đã lưu (người dùng kéo thả tự do) dùng khi đủ MỌI thẻ và toạ độ hợp lệ.
 * Thiếu/hỏng/của mô hình cũ (hàng ngang 7 thẻ, id trigger…) thì về cây mặc định cả bộ; "Sắp xếp lại" cũng về cây mặc định.
 */
export function mergeLayout(saved: unknown, o: Orientation = "v"): Record<CanvasNodeId, Pos> {
  const src = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  if (!MAIN_ORDER.every((id) => isPos(src[id]))) return defaultPositions(o);
  return Object.fromEntries(MAIN_ORDER.map((id) => [id, { x: (src[id] as Pos).x, y: (src[id] as Pos).y }])) as Record<CanvasNodeId, Pos>;
}

/** Tiền tố khoá vị trí node con trong layout đã lưu: `sub:<id>`; toạ độ tương đối so với thẻ cha. */
export const SUB_KEY_PREFIX = "sub:";
export const subKey = (id: string) => `${SUB_KEY_PREFIX}${id}`;

/** Vị trí node con đã lưu (khoá `sub:*`, toạ độ hợp lệ); khoá lạ hoặc hỏng bị bỏ. */
export function pickSubPositions(saved: unknown): Record<string, Pos> {
  const src = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  const entries = Object.entries(src).flatMap(([k, p]) => (k.startsWith(SUB_KEY_PREFIX) && isPos(p) ? [[k, { x: p.x, y: p.y }] as const] : []));
  return Object.fromEntries(entries);
}
