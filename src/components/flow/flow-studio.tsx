"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { rerenderAction, resetFlowLayoutAction, saveFlowLayoutAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DEFAULT_POSITIONS, MAIN_ORDER, SUB_NODES, type CanvasNodeId, type Pos } from "@/lib/flow/layout";
import { buildFlow, formatSlot, STATUS_LABEL, type FlowData, type NodeId, type StepView } from "@/lib/flow/model";
import { nodeTypes } from "./nodes";

type Props = { data: FlowData; layout: Record<CanvasNodeId, Pos> };

export function FlowStudio(props: Props) {
  return (
    <ReactFlowProvider>
      <Studio {...props} />
    </ReactFlowProvider>
  );
}

const EDGE_COLOR = { done: "#2f7d4f", run: "#38bdf8", error: "#7f1d1d", wait: "#3b3b46", skip: "#2a2a31" } as const;

function buildNodes(steps: Record<NodeId, StepView>, layout: Record<CanvasNodeId, Pos>, selected: NodeId): Node[] {
  return [
    ...MAIN_ORDER.map((id) => ({
      id,
      type: id === "agent" ? "agent" : "step",
      position: layout[id],
      data: { view: steps[id], selected: id === selected },
    })),
    ...SUB_NODES.map((s) => ({ id: s.id, type: "sub", position: layout[s.id], data: { id: s.id, title: s.title, subtitle: s.subtitle } })),
  ];
}

function buildEdges(steps: Record<NodeId, StepView>): Edge[] {
  const main = MAIN_ORDER.slice(1).map((id, i) => {
    const state = steps[id].state;
    return {
      id: `e-${id}`,
      source: MAIN_ORDER[i],
      target: id,
      animated: state === "run",
      style: { stroke: EDGE_COLOR[state], strokeWidth: 2 },
    };
  });
  const subs = SUB_NODES.map((s) => ({
    id: `s-${s.id}`,
    source: s.parent,
    sourceHandle: s.slot ?? "sub",
    target: s.id,
    style: { stroke: "#4a4a56", strokeWidth: 1.6, strokeDasharray: "4 5" },
  }));
  return [...main, ...subs];
}

/** Mặc định mở node đầu tiên chưa xong — thường là chỗ người dùng cần xem. */
function firstOpen(steps: Record<NodeId, StepView>): NodeId {
  return MAIN_ORDER.find((id) => steps[id].state !== "done") ?? "video";
}

const time = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

function Studio({ data, layout }: Props) {
  const { steps, notice } = useMemo(() => buildFlow(data), [data]);
  const [selected, setSelected] = useState<NodeId>(() => firstOpen(steps));
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(steps, layout, selected));
  const edges = useMemo(() => buildEdges(steps), [steps]);
  const { fitView, getNodes } = useReactFlow();
  const [, startTransition] = useTransition();
  const v = data.video;
  const [label, tone] = STATUS_LABEL[v.status];

  const select = (id: NodeId) => {
    setSelected(id);
    setNodes((ns) => ns.map((n) => (MAIN_ORDER.includes(n.id as NodeId) ? { ...n, data: { ...n.data, selected: n.id === id } } : n)));
  };

  const savePositions = () => {
    const positions = Object.fromEntries(getNodes().map((n) => [n.id, n.position]));
    startTransition(async () => void (await saveFlowLayoutAction(positions)));
  };

  const resetLayout = () => {
    setNodes((ns) => ns.map((n) => ({ ...n, position: DEFAULT_POSITIONS[n.id as CanvasNodeId] })));
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
    startTransition(async () => void (await resetFlowLayoutAction()));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-[#111115] px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <Link href={`/series/${data.series.id}`} className="block truncate text-xs text-muted hover:text-foreground">
            {data.series.title} › Video #{v.id}
          </Link>
          <h1 className="truncate text-[15px] font-bold">
            Chương {data.chapter.number} · {data.chapter.title}
          </h1>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>● {label}</span>
        {v.publishAt && v.status !== "failed" && (
          <span className="hidden rounded-full border border-border bg-card px-3 py-1 text-xs sm:inline">📅 {formatSlot(v.publishAt)}</span>
        )}
        {v.runUrl && (
          <a href={v.runUrl} target="_blank" className="text-xs text-muted underline hover:text-foreground">
            Log render
          </a>
        )}
        <button type="button" onClick={resetLayout} className="btn-secondary !px-3 !py-1.5 text-xs">
          ⤢ Sắp xếp lại
        </button>
        {(v.status === "failed" || v.status === "ready" || v.status === "queued") && (
          <ActionForm action={rerenderAction.bind(null, v.id)} submitLabel="↻ Render lại" variant="secondary" />
        )}
      </header>

      {notice && (
        <p className={`px-4 py-2 text-xs ${notice.tone === "error" ? "bg-red-950/70 text-red-300" : "bg-sky-950/60 text-sky-200"}`}>
          {notice.text.slice(0, 300)}
        </p>
      )}

      <div className="grid min-h-0 flex-1 md:grid-cols-[1fr_380px]">
        <div className="relative min-h-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={savePositions}
            onNodeClick={(_, n) => select((SUB_NODES.find((s) => s.id === n.id)?.parent ?? n.id) as NodeId)}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.3}
            maxZoom={2}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
            style={{ background: "#0f0f13" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#2a2a33" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside data-selected={selected} className="hidden border-l border-border bg-[#141418] md:block" />
      </div>

      <footer className="flex gap-5 overflow-x-auto whitespace-nowrap border-t border-border bg-[#111115] px-4 py-2 text-xs text-muted">
        <span>
          <b className="text-foreground">{time(v.createdAt)}</b> Tạo video
        </span>
        <span>
          <b className="text-foreground">{time(v.updatedAt)}</b> {label}
        </span>
        {v.error && <span className="text-red-400">{v.error.slice(0, 120)}</span>}
        <span className="opacity-60">Nhật ký từng bước sẽ có ở bản cập nhật pipeline</span>
      </footer>
    </div>
  );
}
