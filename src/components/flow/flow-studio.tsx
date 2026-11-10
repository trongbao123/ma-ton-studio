"use client";

import "@xyflow/react/dist/style.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  PanOnScrollMode,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { rerenderAction, resetFlowLayoutAction, saveFlowLayoutAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CARD_WIDTH, DEFAULT_POSITIONS, MAIN_ORDER, ROW_Y, type CanvasNodeId, type Pos } from "@/lib/flow/layout";
import { buildFlow, formatSlot, formatTime, isStale, STATUS_LABEL, TITLES, type CardId, type CardState, type CardView, type FlowData, type Issue, type NodeId } from "@/lib/flow/model";
import { useLive, useLiveVideo } from "@/lib/live/store";
import { buildSubs, SUB_Y, subOffsetX, type SubView } from "@/lib/flow/subnodes";
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

/** Cao độ (trên canvas) mà viewport canh giữa — thẻ ~400px + hàng node con ~110px nằm gọn trong khung 600px. */
const VIEW_CENTER_Y = ROW_Y + 260;

const EDGE_COLOR: Record<CardState, string> = { done: "#2f7d4f", run: "#38bdf8", error: "#7f1d1d", quota: "#b45309", wait: "#3b3b46", idle: "#3b3b46", skip: "#2a2a31" };

function buildNodes(cards: Record<CardId, CardView>, subs: SubView[], layout: Record<CanvasNodeId, Pos>, selected: CardId): Node[] {
  const main: Node[] = MAIN_ORDER.map((id) => ({
    id,
    type: "card",
    position: layout[id],
    data: { view: cards[id], selected: id === selected },
  }));
  // Node con gắn parentId nên đi theo thẻ cha khi kéo; vị trí tương đối, không lưu.
  const children: Node[] = subs.map((view) => {
    const siblings = subs.filter((x) => x.parent === view.parent);
    return {
      id: view.id,
      type: "sub",
      parentId: view.parent,
      position: { x: subOffsetX(siblings.indexOf(view), siblings.length, CARD_WIDTH), y: SUB_Y },
      draggable: false,
      data: { view },
    };
  });
  return [...main, ...children];
}

function buildEdges(cards: Record<CardId, CardView>, subs: SubView[]): Edge[] {
  const chain: Edge[] = MAIN_ORDER.slice(1).map((id, i) => {
    const state = cards[id].state;
    return {
      id: `e-${id}`,
      source: MAIN_ORDER[i],
      sourceHandle: "out",
      target: id,
      type: "smoothstep",
      animated: state === "run",
      style: { stroke: EDGE_COLOR[state], strokeWidth: 3 },
    };
  });
  const dotted: Edge[] = subs.map((x) => ({
    id: `s-${x.id}`,
    source: x.parent,
    sourceHandle: "tools",
    target: x.id,
    type: "smoothstep",
    style: { stroke: x.ok ? "#4b8f6a" : "#4a4a55", strokeWidth: 2, strokeDasharray: "2 7", strokeLinecap: "round" },
  }));
  return [...chain, ...dotted];
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
    <div role="status" className="flex flex-wrap items-center gap-2 border-b border-border bg-[#111115] px-5 py-2.5 text-sm">
      <b className="shrink-0 text-zinc-300">Đang kẹt / cần làm</b>
      {issues.map((i) => (
        <button key={i.text} type="button" onClick={() => onPick(i.card)} title={i.text} className={`max-w-full truncate rounded-full border px-3 py-1 text-left ${ISSUE_TONE[i.tone]}`}>
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
  const subs = useMemo(() => buildSubs(data, cards), [data, cards]);
  const [selected, setSelected] = useState<CardId>(() => firstOpen(cards));
  const [nodes, setNodes, onNodesChange] = useNodesState(buildNodes(cards, subs, layout, selected));
  const edges = useMemo(() => buildEdges(cards, subs), [cards, subs]);
  const { setCenter, getNode, getNodes } = useReactFlow();
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
  // Canh viewport giữa thẻ đang chọn ở zoom 100% (chữ luôn đọc được); 7 thẻ rộng hơn màn hình nên kéo / cuộn ngang để xem tiếp.
  const centerOn = useCallback(
    (id: CardId, duration = 0) => {
      const n = getNode(id);
      if (n) void setCenter(n.position.x + CARD_WIDTH / 2, VIEW_CENTER_Y, { zoom: 1, duration });
    },
    [getNode, setCenter],
  );
  useEffect(() => {
    const onResize = () => centerOn(selected);
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, [centerOn, selected]);
  // Hàng thẻ luôn thẳng: kéo thẻ chỉ trượt ngang, giữ nguyên y.
  const onChange = (changes: NodeChange<Node>[]) =>
    onNodesChange(changes.map((c) => (c.type === "position" && c.position ? { ...c, position: { x: c.position.x, y: ROW_Y } } : c)));
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
    centerOn(id, 300);
    setNodes((ns) => ns.map((n) => ({ ...n, data: { ...n.data, selected: n.id === id } })));
  };

  const savePositions = () => {
    const positions = Object.fromEntries(getNodes().filter((n) => !n.parentId).map((n) => [n.id, n.position]));
    startTransition(async () => void (await saveFlowLayoutAction(positions)));
  };

  const resetLayout = () => {
    setNodes((ns) => ns.map((n) => (n.parentId ? n : { ...n, position: DEFAULT_POSITIONS[n.id as CanvasNodeId] })));
    requestAnimationFrame(() => centerOn(selected, 300));
    startTransition(async () => void (await resetFlowLayoutAction()));
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:overflow-hidden">
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
            <p className="truncate text-sm text-muted">
              <Link href="/videos" className="hover:text-foreground">
                Video
              </Link>
              <span className="mx-1.5 opacity-50">/</span>
              <Link href={`/series/${data.series.id}`} className="hover:text-foreground">
                {data.series.title}
              </Link>
              <span className="mx-1.5 opacity-50">/</span>#{v.id}
            </p>
            <h1 className="truncate text-lg font-bold">
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
        <span className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${tone}`}>
          <span className={live ? "animate-pulse" : ""}>●</span> {label}
          {live && <span className="ml-1 font-normal opacity-70">· trực tiếp</span>}
        </span>
        {v.publishAt && v.status !== "failed" && (
          <span className="hidden rounded-full border border-border bg-card px-3.5 py-1.5 text-sm sm:inline">📅 {formatSlot(v.publishAt)}</span>
        )}
        {v.runUrl && (
          <a href={v.runUrl} target="_blank" className="text-sm text-muted underline hover:text-foreground">
            Log render
          </a>
        )}
        <button type="button" onClick={resetLayout} className="btn-secondary !px-3.5 !py-1.5">
          ⤢<span className="hidden sm:inline"> Sắp xếp lại</span>
        </button>
        {(v.status === "failed" || v.status === "ready" || v.status === "queued" || stale) && (
          <ActionForm action={rerenderAction.bind(null, v.id)} submitLabel="↻ Render lại" variant="secondary" />
        )}
      </header>

      <IssueStrip issues={issues} onPick={select} />

      {/* Dưới 1024px trang cuộn dọc: canvas → chi tiết → nhật ký. Từ 1024px: canvas + nhật ký bên trái, chi tiết cố định bên phải (cuộn riêng). */}
      <div className="flow-grid grid shrink-0 grid-cols-1 content-start lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-hidden">
        <div className="area-canvas relative h-[580px] min-w-0 border-b border-border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onChange}
            onNodeDragStop={savePositions}
            onNodeClick={(_, n) => select((n.parentId ?? n.id) as CardId)}
            onInit={() => centerOn(selected)}
            nodesConnectable={false}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            minZoom={0.85}
            maxZoom={1.5}
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            panOnScroll
            panOnScrollMode={PanOnScrollMode.Horizontal}
            preventScrolling={false}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
            style={{ background: "#0f0f13" }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color="#2a2a33" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
          <p className="pointer-events-none absolute right-4 top-3 text-xs text-zinc-500">Kéo hoặc cuộn ngang để xem các bước khác</p>
        </div>
        <div className="area-insp flex min-h-0 flex-col [&>aside]:flex-1">
          <Inspector data={data} cards={cards} selected={selected} />
        </div>
        <section className="area-log min-w-0 px-5 py-4 text-sm text-muted lg:overflow-y-auto">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Nhật ký</h2>
          <ul className="space-y-1.5">
            <li>
              <b className="mr-2 tabular-nums text-foreground">{formatTime(v.createdAt)}</b>Tạo video
            </li>
            <li>
              <b className="mr-2 tabular-nums text-foreground">{formatTime(v.updatedAt)}</b>
              {label}
            </li>
            {v.status === "failed" && v.error && <li className="text-red-400">{v.error.slice(0, 200)}</li>}
            {recentLog(data).map((l, i) => (
              <li key={i}>
                <b className="mr-2 tabular-nums text-foreground">{formatTime(l.at).slice(0, 5)}</b>
                {l.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
