"use client";

import "@xyflow/react/dist/style.css";
import { Background, BackgroundVariant, Controls, PanOnScrollMode, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useTransition } from "react";
import { resetFlowLayoutAction, saveFlowLayoutAction } from "@/app/actions";
import { edgeTone, TREE_EDGES } from "@/lib/flow/edges";
import { CARD_WIDTH, defaultPositions, MAIN_ORDER, ROW_OF, subKey, type CanvasNodeId, type Orientation, type Pos } from "@/lib/flow/layout";
import type { CardId, CardView } from "@/lib/flow/model";
import { subOffset, type SubView } from "@/lib/flow/subnodes";
import { edgeTypes } from "./flow-edge";
import { nodeTypes } from "./nodes";

/** Khung nhìn ôm cả cây: chừa lề 6%, không phóng quá 100%. */
const FIT = { padding: 0.06, minZoom: 0.3, maxZoom: 1 } as const;
/** Thời gian pan/zoom mượt khi chọn thẻ hoặc sắp xếp lại (ms). */
const CAMERA_MS = 400;
/** Chọn thẻ thì zoom lên ít nhất mức này để chữ đọc được. */
const FOCUS_MIN_ZOOM = 0.8;
const DEFAULT_CARD_HEIGHT = 150;
/** Vừa chọn thẻ trong khoảng này thì coi việc đổi bề rộng canvas là hệ quả của lần chọn. */
const FOCUS_RECENT_MS = 600;

/** Vị trí mặc định (tương đối thẻ cha) của một node con trong hàng/cột các node con cùng cha. */
function defaultSubPosition(subs: SubView[], id: string, horizontal: boolean): Pos {
  const view = subs.find((x) => x.id === id);
  const siblings = subs.filter((x) => x.parent === view?.parent);
  return subOffset(siblings.findIndex((x) => x.id === id), CARD_WIDTH, horizontal, siblings.length);
}

function buildNodes(cards: Record<CardId, CardView>, subs: SubView[], layout: Record<CanvasNodeId, Pos>, subLayout: Record<string, Pos>, selected: CardId, orientation: Orientation): Node[] {
  const horizontal = orientation === "h";
  const main: Node[] = MAIN_ORDER.map((id) => ({
    id,
    type: "card",
    position: layout[id],
    data: { view: cards[id], selected: id === selected, row: ROW_OF[id], horizontal },
  }));
  // Node con gắn parentId nên đi theo thẻ cha khi kéo; vị trí tương đối với thẻ cha, kéo riêng được và lưu dưới khoá `sub:<id>`.
  const children: Node[] = subs.map((view) => ({
    id: view.id,
    type: "sub",
    parentId: view.parent,
    position: subLayout[subKey(view.id)] ?? defaultSubPosition(subs, view.id, horizontal),
    data: { view, row: ROW_OF[view.parent], horizontal },
  }));
  return [...main, ...children];
}

function buildEdges(cards: Record<CardId, CardView>, subs: SubView[]): Edge[] {
  const chain: Edge[] = TREE_EDGES.map(([from, to]) => ({
    id: `e-${from}-${to}`,
    source: from,
    sourceHandle: "out",
    target: to,
    type: "flow",
    data: { tone: edgeTone(from, to, cards) },
  }));
  const dotted: Edge[] = subs.map((x) => ({
    id: `s-${x.id}`,
    source: x.parent,
    sourceHandle: "tools",
    target: x.id,
    // Bezier toả ra từ 1 cổng: smoothstep với khoảng hở ngắn bị bẻ góc vòng vèo, nhìn rối.
    type: "default",
    style: { stroke: x.ok ? "#4b8f6a" : "#4a4a55", strokeWidth: 1.6, strokeDasharray: "3 6", strokeLinecap: "round" },
  }));
  return [...chain, ...dotted];
}

type CanvasProps = {
  cards: Record<CardId, CardView>;
  subs: SubView[];
  layout: Record<CanvasNodeId, Pos>;
  /** Vị trí node con đã lưu (khoá `sub:<id>`, tương đối thẻ cha); thiếu thì về chỗ mặc định. */
  subLayout: Record<string, Pos>;
  selected: CardId;
  /** Đổi theo bảng chi tiết đóng/mở → canvas đổi bề rộng, cần ôm lại cả cây. */
  panelOpen: boolean;
  /** Tăng lên mỗi lần bấm "Sắp xếp lại" → về cây mặc định. */
  resetCount: number;
  /** Dọc / ngang — đổi hướng thì canvas dựng lại từ đầu (key) với bố cục của hướng đó. */
  orientation: Orientation;
  onPick: (id: CardId) => void;
};

/**
 * Canvas React Flow của màn flow. Tách riêng file để nạp lười (next/dynamic) — thư viện @xyflow không nằm trong JS đầu trang.
 */
export default function FlowCanvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({ cards, subs, layout, subLayout, selected, panelOpen, resetCount, orientation, onPick }: CanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(cards, subs, layout, subLayout, selected, orientation));
  const edges = useMemo(() => buildEdges(cards, subs), [cards, subs]);
  const { setCenter, getNode, getNodes, getZoom, fitView } = useReactFlow();
  const [, startTransition] = useTransition();
  // useNodesState chỉ lấy giá trị đầu — dữ liệu mới từ server (render lại, đã đăng, polling) phải đẩy vào node, giữ nguyên vị trí.
  useEffect(() => {
    setNodes((ns) =>
      ns.map((n) => {
        const sub = subs.find((x) => x.id === n.id);
        return sub ? { ...n, data: { ...n.data, view: sub } } : { ...n, data: { ...n.data, view: cards[n.id as CardId] } };
      }),
    );
  }, [cards, subs, setNodes]);

  // Chọn thẻ: camera trượt mượt tới thẻ, giữ zoom hiện tại nhưng không nhỏ hơn FOCUS_MIN_ZOOM.
  const lastFocusAt = useRef(0);
  const focusOn = useCallback(
    (id: CardId) => {
      const n = getNode(id);
      if (!n) return;
      lastFocusAt.current = Date.now();
      const h = n.measured?.height ?? DEFAULT_CARD_HEIGHT;
      void setCenter(n.position.x + CARD_WIDTH / 2, n.position.y + h / 2, { zoom: Math.max(getZoom(), FOCUS_MIN_ZOOM), duration: CAMERA_MS });
    },
    [getNode, setCenter, getZoom],
  );
  const fitAll = useCallback((duration = 0) => void fitView({ ...FIT, duration }), [fitView]);

  // Chọn thẻ từ nơi khác (dải "Đang kẹt") hoặc bấm trên canvas: tô viền thẻ chọn + camera tới thẻ. Lần dựng đầu giữ nguyên khung ôm cả cây.
  const firstSelect = useRef(true);
  useEffect(() => {
    setNodes((ns) => ns.map((n) => (n.parentId ? n : { ...n, data: { ...n.data, selected: n.id === selected } })));
    if (firstSelect.current) firstSelect.current = false;
    else focusOn(selected);
  }, [selected, setNodes, focusOn]);

  useEffect(() => {
    const onResize = () => fitAll();
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [fitAll]);

  // Đóng/mở bảng chi tiết đổi bề rộng canvas → ôm lại cả cây sau khi layout xong.
  const firstPanel = useRef(true);
  useEffect(() => {
    if (firstPanel.current) return void (firstPanel.current = false);
    const t = setTimeout(() => {
      // Bảng vừa mở do chọn thẻ → canh lại theo thẻ đó thay vì ôm cả cây.
      if (Date.now() - lastFocusAt.current < FOCUS_RECENT_MS) focusOn(selected);
      else fitAll(CAMERA_MS);
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi bảng đóng/mở, không phải mỗi lần đổi thẻ chọn
  }, [panelOpen]);

  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) return void (firstReset.current = false);
    setNodes((ns) =>
      ns.map((n) => {
        if (!n.parentId) return { ...n, position: defaultPositions(orientation)[n.id as CanvasNodeId] };
        return { ...n, position: defaultSubPosition(subs, n.id, orientation === "h") };
      }),
    );
    requestAnimationFrame(() => fitAll(CAMERA_MS));
    startTransition(async () => void (await resetFlowLayoutAction(orientation)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy khi bấm "Sắp xếp lại"; đổi hướng thì canvas dựng lại từ đầu
  }, [resetCount, setNodes, fitAll]);

  // Kéo thả tự do (node con đi theo thẻ cha, kéo riêng thì lưu vị trí tương đối); lưu khi thả chuột.
  const savePositions = () => {
    // Node con chỉ lưu khi đã bị kéo khỏi chỗ mặc định (chỗ mặc định vẫn theo số node con hiện có).
    const moved = (n: Node) => !n.parentId || JSON.stringify(n.position) !== JSON.stringify(defaultSubPosition(subs, n.id, orientation === "h"));
    const positions = Object.fromEntries(getNodes().filter(moved).map((n) => [n.parentId ? subKey(n.id) : n.id, n.position]));
    startTransition(async () => void (await saveFlowLayoutAction(positions, orientation)));
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={savePositions}
      onNodeClick={(_, n) => {
        const id = (n.parentId ?? n.id) as CardId;
        onPick(id);
        focusOn(id);
      }}
      fitView
      fitViewOptions={FIT}
      nodesConnectable={false}
      minZoom={0.3}
      maxZoom={1.5}
      zoomOnScroll={false}
      // Giữ ⌘/Ctrl + cuộn (hoặc chụm 2 ngón trên trackpad) để thu nhỏ/phóng to; cuộn thường thì dời khung nhìn.
      zoomActivationKeyCode={["Meta", "Control"]}
      zoomOnDoubleClick={false}
      panOnScroll
      panOnScrollMode={PanOnScrollMode.Free}
      preventScrolling={false}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
      style={{ background: "#0f0f13" }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#2a2a33" />
      <Controls showInteractive={false} position="bottom-right" />
    </ReactFlow>
  );
}
