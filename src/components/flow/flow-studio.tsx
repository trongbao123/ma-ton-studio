"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { rerenderAction, resetFlowLayoutAction, saveFlowLayoutAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { DEFAULT_POSITIONS, MAIN_ORDER, type CanvasNodeId, type Pos } from "@/lib/flow/layout";
import { buildFlow, formatSlot, formatTime, isStale, STATUS_LABEL, TITLES, type CardId, type CardState, type CardView, type FlowData, type Issue, type NodeId } from "@/lib/flow/model";
import { useLive, useLiveVideo } from "@/lib/live/store";
import { Inspector } from "./inspector";
import { nodeTypes } from "./nodes";

type Props = { data: FlowData; layout: Record<CanvasNodeId, Pos> };

export function FlowStudio(props: Props) {
  return (
    <ReactFlowProvider>
      <Studio {...props} />
    </ReactFlowProvider>
  );
}

const EDGE_COLOR: Record<CardState, string> = { done: "#2f7d4f", run: "#38bdf8", error: "#7f1d1d", quota: "#b45309", wait: "#3b3b46", idle: "#3b3b46", skip: "#2a2a31" };

function buildNodes(cards: Record<CardId, CardView>, layout: Record<CanvasNodeId, Pos>, selected: CardId): Node[] {
  return MAIN_ORDER.map((id) => ({
    id,
    type: "card",
    position: layout[id],
    data: { view: cards[id], selected: id === selected },
  }));
}

function buildEdges(cards: Record<CardId, CardView>): Edge[] {
  return MAIN_ORDER.slice(1).map((id, i) => {
    const state = cards[id].state;
    return {
      id: `e-${id}`,
      source: MAIN_ORDER[i],
      target: id,
      animated: state === "run",
      style: { stroke: EDGE_COLOR[state], strokeWidth: 2 },
    };
  });
}

/** Mặc định mở thẻ đầu tiên chưa xong — thường là chỗ người dùng cần xem (Xu hướng chỉ là bối cảnh nên bỏ qua). */
function firstOpen(cards: Record<CardId, CardView>): CardId {
  return MAIN_ORDER.find((id) => id !== "trends" && cards[id].state !== "done") ?? "video";
}

const ISSUE_TONE: Record<Issue["tone"], string> = {
  error: "border-red-500/40 bg-red-950/60 text-red-200",
  warn: "border-amber-500/40 bg-amber-950/50 text-amber-200",
  info: "border-sky-500/40 bg-sky-950/50 text-sky-200",
};

/** Dải "Đang kẹt / cần làm" phía trên canvas — ẩn khi không có gì. Bấm một việc để mở thẻ liên quan. */
function IssueStrip({ issues, onPick }: { issues: Issue[]; onPick: (id: CardId) => void }) {
  if (!issues.length) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b border-border bg-[#111115] px-4 py-2 text-xs">
      <b className="shrink-0 text-zinc-300">Đang kẹt / cần làm</b>
      {issues.map((i) => (
        <button key={i.text} type="button" onClick={() => onPick(i.card)} title={i.text} className={`max-w-full truncate rounded-full border px-2.5 py-0.5 text-left ${ISSUE_TONE[i.tone]}`}>
          {i.text.slice(0, 160)}
        </button>
      ))}
    </div>
  );
}

const POLL_MS = 2000;
const noopSubscribe = () => () => {};

/** 6 dòng nhật ký mới nhất của mọi bước, mới nhất trước — chạy ở thanh dưới cùng. */
function recentLog(d: FlowData) {
  return Object.entries(d.video.progress?.steps ?? {})
    .flatMap(([id, p]) => (p?.log ?? []).map((l) => ({ ...l, text: `${TITLES[id as NodeId]}: ${l.text}` })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);
}

/** Video còn đang chạy (render / chờ máy nhận job / upload YouTube) thì cần cập nhật trực tiếp. */
const isLive = (d: FlowData) =>
  (d.video.status === "rendering" && !isStale(d.video)) || d.video.uploadStatus === "uploading" || (d.video.status === "queued" && !d.video.error);

/**
 * Dữ liệu màn flow cập nhật realtime qua luồng SSE dùng chung (/api/live?video=id).
 * SSE hỏng liên tục (conn = "fallback") thì quay về hỏi `/api/flow/[id]` mỗi 2s khi video đang chạy và tab đang mở.
 * Next ẩn trang đã rời bằng <Activity> → effect bị dọn, interval tự dừng.
 */
function useLiveFlow(initial: FlowData) {
  const [data, setData] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [seenPush, setSeenPush] = useState<FlowData | null>(null);
  // Server gửi dữ liệu mới (sau action revalidate) thì lấy luôn.
  if (seen !== initial) {
    setSeen(initial);
    setData(initial);
  }
  const live = isLive(data);
  const id = data.video.id;
  useLiveVideo(id);
  const { flow, conn } = useLive();
  // Bản đẩy từ SSE; bỏ qua bản cũ hơn dữ liệu đang có (vd còn sót từ lần xem trước của store dùng chung).
  if (flow && flow !== seenPush && flow.video.id === id) {
    setSeenPush(flow);
    if (flow.video.updatedAt >= data.video.updatedAt) setData(flow);
  }
  const polling = live && conn === "fallback";
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(`/api/flow/${id}`, { cache: "no-store" }).catch(() => null);
      if (!stopped && res?.ok) setData((await res.json()) as FlowData);
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [polling, id]);
  return { data, live };
}

function Studio({ data: initial, layout }: Props) {
  const { data, live } = useLiveFlow(initial);
  const { cards, issues: baseIssues } = useMemo(() => buildFlow(data), [data]);
  const [selected, setSelected] = useState<CardId>(() => firstOpen(cards));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(cards, layout, selected));
  const edges = useMemo(() => buildEdges(cards), [cards]);
  const { fitView, getNodes } = useReactFlow();
  const [, startTransition] = useTransition();
  const measured = useNodesInitialized();
  // useNodesState chỉ lấy giá trị đầu — dữ liệu mới từ server (render lại, đã đăng, polling) phải đẩy vào node, giữ nguyên vị trí.
  useEffect(() => {
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, view: cards[n.id as CardId] } })));
  }, [cards, setNodes]);
  // fitView ban đầu có thể chạy trước khi node đo xong kích thước (hay gặp trên điện thoại) → fit lại, và fit khi xoay/đổi cỡ màn hình.
  useEffect(() => {
    if (!measured) return;
    const fit = () => void fitView({ padding: 0.08 });
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [measured, fitView]);
  const v = data.video;
  const [label, tone] = STATUS_LABEL[v.status];
  // Chỉ tính trên client (cần giờ hiện tại) để HTML server và lần hydrate đầu giống nhau.
  const onClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const stale = onClient && isStale(v);
  const issues: Issue[] = stale
    ? [{ tone: "warn", text: "Video kẹt ở \"đang render\" — job có thể đã bị huỷ, bấm Render lại", card: "video" }, ...baseIssues]
    : baseIssues;

  const select = (id: CardId) => {
    setSelected(id);
    setSheetOpen(true);
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, selected: n.id === id } })));
  };

  const savePositions = () => {
    const positions = Object.fromEntries(getNodes().map((n) => [n.id, n.position]));
    startTransition(async () => void (await saveFlowLayoutAction(positions)));
  };

  const resetLayout = () => {
    setNodes((ns) => ns.map((n) => ({ ...n, position: DEFAULT_POSITIONS[n.id as CanvasNodeId] })));
    requestAnimationFrame(() => fitView({ padding: 0.08, duration: 300 }));
    startTransition(async () => void (await resetFlowLayoutAction()));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border bg-[#111115] px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-0 sm:flex-1">
          <Link
            href="/videos"
            aria-label="Về danh sách video"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-red-500 to-fuchsia-700 text-sm font-black text-white shadow-[0_4px_14px_rgba(239,68,68,.35)]"
          >
            魔
          </Link>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted">
              <Link href="/videos" className="hover:text-foreground">
                Video
              </Link>
              <span className="mx-1.5 opacity-50">/</span>
              <Link href={`/series/${data.series.id}`} className="hover:text-foreground">
                {data.series.title}
              </Link>
              <span className="mx-1.5 opacity-50">/</span>#{v.id}
            </p>
            <h1 className="truncate text-base font-bold">
              {/* Bấm tiêu đề → về trang truyện. */}
              <Link
                href={`/series/${data.series.id}`}
                title={`Về trang truyện ${data.series.title}`}
                className="underline-offset-4 transition-colors hover:text-gold hover:underline"
              >
                Chương {data.chapter.number} · {data.chapter.title}
              </Link>
            </h1>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>
          <span className={live ? "animate-pulse" : ""}>●</span> {label}
          {live && <span className="ml-1 font-normal opacity-70">· trực tiếp</span>}
        </span>
        {v.publishAt && v.status !== "failed" && (
          <span className="hidden rounded-full border border-border bg-card px-3 py-1 text-xs sm:inline">📅 {formatSlot(v.publishAt)}</span>
        )}
        {v.runUrl && (
          <a href={v.runUrl} target="_blank" className="text-xs text-muted underline hover:text-foreground">
            Log render
          </a>
        )}
        <button type="button" onClick={resetLayout} className="btn-secondary !px-3 !py-1.5 text-xs">
          ⤢<span className="hidden sm:inline"> Sắp xếp lại</span>
        </button>
        {(v.status === "failed" || v.status === "ready" || v.status === "queued" || stale) && (
          <ActionForm action={rerenderAction.bind(null, v.id)} submitLabel="↻ Render lại" variant="secondary" />
        )}
      </header>

      <IssueStrip issues={issues} onPick={select} />

      {/* minmax(0,1fr): không để canvas đẩy rộng cột làm bảng chi tiết tràn khỏi màn hình. */}
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_400px]">
        <div className="relative min-h-0 pb-14 md:pb-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={savePositions}
            onNodeClick={(_, n) => select(n.id as CardId)}
            nodesConnectable={false}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            minZoom={0.15}
            maxZoom={2}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
            style={{ background: "#0f0f13" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#2a2a33" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <Inspector data={data} cards={cards} selected={selected} open={sheetOpen} onToggle={setSheetOpen} />
      </div>

      <footer className="hidden gap-6 overflow-x-auto whitespace-nowrap [scrollbar-width:none] border-t border-border bg-[#111115] px-5 py-2.5 text-xs text-muted md:flex">
        <span>
          <b className="text-foreground">{formatTime(v.createdAt)}</b> Tạo video
        </span>
        <span>
          <b className="text-foreground">{formatTime(v.updatedAt)}</b> {label}
        </span>
        {v.status === "failed" && v.error && <span className="text-red-400">{v.error.slice(0, 120)}</span>}
        {recentLog(data).map((l, i) => (
          <span key={i}>
            <b className="text-foreground">{formatTime(l.at).slice(0, 5)}</b> {l.text}
          </span>
        ))}
      </footer>
    </div>
  );
}
