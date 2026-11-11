import type { CardId, CardState, CardView } from "./model";

/** Dây chính của cây: rẽ nhánh sau SEO, hợp nhánh ở Dựng video, rẽ rồi hợp lại ở YouTube. */
export const TREE_EDGES: [CardId, CardId][] = [
  ["trends", "chapter"],
  ["chapter", "seo"],
  ["seo", "tts"],
  ["seo", "images"],
  ["seo", "i2v"],
  ["seo", "thumbnail"],
  ["tts", "video"],
  ["images", "video"],
  ["i2v", "video"],
  ["thumbnail", "video"],
  ["video", "long"],
  ["video", "short"],
  ["long", "youtube"],
  ["short", "youtube"],
];

export type EdgeTone = "run" | "done" | "error" | "quota" | "idle";

/** Thẻ nhận nhiều dây vào (hợp nhánh): dây theo trạng thái của thẻ nguồn; các thẻ còn lại theo thẻ đích. */
const MERGE_TARGETS: CardId[] = ["video", "youtube"];

const TONE_OF: Record<CardState, EdgeTone> = { run: "run", done: "done", error: "error", quota: "quota", wait: "idle", idle: "idle", skip: "idle" };

/** Màu / hoạt ảnh của dây: chạy = chấm sáng chảy, xong = xanh tĩnh, chưa tới = xám mờ. */
export function edgeTone(from: CardId, to: CardId, cards: Record<CardId, CardView>): EdgeTone {
  return TONE_OF[cards[MERGE_TARGETS.includes(to) ? from : to].state];
}
