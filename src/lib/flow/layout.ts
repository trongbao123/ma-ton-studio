import type { NodeId } from "./model";

export type SubNodeId = "model" | "bible" | "summary" | "vidiq" | "imageModel" | "label";
export type CanvasNodeId = NodeId | SubNodeId;
export type Pos = { x: number; y: number };

export const MAIN_ORDER: NodeId[] = ["trigger", "agent", "tts", "images", "video", "youtube"];

export const SUB_NODES: { id: SubNodeId; parent: NodeId; slot?: "model" | "memory" | "tool"; title: string; subtitle: string }[] = [
  { id: "model", parent: "agent", slot: "model", title: "Chat model", subtitle: "Claude · GPT · Gemini" },
  { id: "bible", parent: "agent", slot: "memory", title: "Memory", subtitle: "Story bible" },
  { id: "summary", parent: "agent", slot: "memory", title: "Tóm tắt", subtitle: "chương trước" },
  { id: "vidiq", parent: "agent", slot: "tool", title: "vidIQ", subtitle: "từ khóa · chấm tiêu đề" },
  { id: "imageModel", parent: "images", title: "Cloudflare", subtitle: "FLUX" },
  { id: "label", parent: "youtube", title: "Nhãn AI", subtitle: "+ lịch đăng" },
];

export const DEFAULT_POSITIONS: Record<CanvasNodeId, Pos> = {
  trigger: { x: 0, y: 150 },
  agent: { x: 170, y: 145 },
  tts: { x: 490, y: 150 },
  images: { x: 650, y: 150 },
  video: { x: 810, y: 150 },
  youtube: { x: 970, y: 150 },
  model: { x: 130, y: 370 },
  bible: { x: 220, y: 370 },
  summary: { x: 310, y: 370 },
  vidiq: { x: 400, y: 370 },
  imageModel: { x: 666, y: 360 },
  label: { x: 986, y: 360 },
};

export const LAYOUT_KEY = "flow_layout";

const isPos = (p: unknown): p is Pos =>
  typeof p === "object" && p !== null && Number.isFinite((p as Pos).x) && Number.isFinite((p as Pos).y);

/** Ghép bố cục đã lưu với mặc định: giữ vị trí hợp lệ, phần hỏng/thiếu dùng mặc định, bỏ khóa lạ. */
export function mergeLayout(saved: unknown): Record<CanvasNodeId, Pos> {
  const src = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_POSITIONS).map(([id, def]) => {
      const p = src[id];
      return [id, isPos(p) ? { x: p.x, y: p.y } : def];
    }),
  ) as Record<CanvasNodeId, Pos>;
}
