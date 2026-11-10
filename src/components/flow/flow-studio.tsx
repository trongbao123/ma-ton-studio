"use client";

import { ChevronDown, ChevronUp, PanelRightClose, PanelRightOpen } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { rerenderAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { MAIN_ORDER, type CanvasNodeId, type Pos } from "@/lib/flow/layout";
import { buildFlow, formatSlot, formatTime, isStale, STATUS_LABEL, TITLES, type CardId, type CardView, type FlowData, type Issue, type NodeId } from "@/lib/flow/model";
import { useLive, useLiveVideo } from "@/lib/live/store";
import { buildSubs } from "@/lib/flow/subnodes";
import { Inspector } from "./inspector";

/** Canvas React Flow nạp lười, chỉ ở trình duyệt: JS của @xyflow không nằm trong gói đầu trang; trong lúc chờ hiện khung xương. */
const FlowCanvas = dynamic(() => import("./flow-canvas"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center bg-[#0f0f13]" aria-busy>
      <p className="animate-pulse text-sm text-zinc-500">Đang dựng sơ đồ…</p>
    </div>
  ),
});

type Props = { data: FlowData; layout: Record<CanvasNodeId, Pos> };

export function FlowStudio(props: Props) {
  return <Studio {...props} />;
}

/** Mặc định mở thẻ đầu tiên chưa xong — thường là chỗ người dùng cần xem (Xu hướng chỉ là bối cảnh nên bỏ qua). */
function firstOpen(cards: Record<CardId, CardView>): CardId {
  return MAIN_ORDER.find((id) => id !== "trends" && cards[id].state !== "done") ?? "youtube";
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
  const v = data.video;
  const [label, tone] = STATUS_LABEL[v.status];
  // Chỉ tính trên client (cần giờ hiện tại) để HTML server và lần hydrate đầu giống nhau.
  const onClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const stale = onClient && isStale(v);
  const issues: Issue[] = stale
    ? [{ tone: "warn", text: "Video kẹt ở \"đang render\" — job có thể đã bị huỷ, bấm Render lại", card: "video" }, ...baseIssues]
    : baseIssues;

  // Thu gọn bảng chi tiết / nhật ký để canvas rộng hơn; nhớ theo trình duyệt.
  const [panelOpen, setPanelOpen] = usePref("flow:panel", true);
  const [logOpen, setLogOpen] = usePref("flow:log", true);

  const [resetCount, setResetCount] = useState(0);
  const select = useCallback(
    (id: CardId) => {
      setSelected(id);
      setPanelOpen(true);
    },
    [setPanelOpen],
  );

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
        <button type="button" onClick={() => setResetCount((n) => n + 1)} className="btn-secondary !px-3.5 !py-1.5">
          ⤢<span className="hidden sm:inline"> Sắp xếp lại</span>
        </button>
        {(v.status === "failed" || v.status === "ready" || v.status === "queued" || stale) && (
          <ActionForm action={rerenderAction.bind(null, v.id)} submitLabel="↻ Render lại" variant="secondary" />
        )}
      </header>

      <IssueStrip issues={issues} onPick={select} />

      {/* Dưới 1024px trang cuộn dọc: canvas → chi tiết → nhật ký. Từ 1024px: canvas + nhật ký bên trái, chi tiết cố định bên phải (cuộn riêng). */}
      <div
        data-panel={panelOpen ? "open" : "closed"}
        className="flow-grid grid shrink-0 grid-cols-1 content-start lg:min-h-0 lg:flex-1 lg:shrink lg:overflow-hidden"
      >
        <div className={`area-canvas relative min-w-0 border-b border-border ${logOpen ? "h-[640px] lg:h-[calc(100dvh-230px)] lg:min-h-[560px]" : "h-[640px] lg:h-full"}`}>
          <FlowCanvas cards={cards} subs={subs} layout={layout} selected={selected} panelOpen={panelOpen} resetCount={resetCount} onPick={select} />
          <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-zinc-500">Kéo để dời · ⌘/Ctrl + cuộn để zoom</p>
        </div>
        <div className="area-insp relative flex min-h-0 flex-col [&>aside]:flex-1">
          {panelOpen ? (
            <>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                title="Thu gọn bảng chi tiết"
                className="absolute right-3 top-3 z-10 hidden rounded-lg border border-border bg-card p-1.5 text-muted hover:text-foreground lg:block"
              >
                <PanelRightClose size={18} />
              </button>
              <Inspector data={data} cards={cards} selected={selected} />
            </>
          ) : (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              title="Mở bảng chi tiết"
              className="flex h-full w-full flex-col items-center gap-3 border-l border-border bg-card/60 pt-4 text-muted hover:text-foreground"
            >
              <PanelRightOpen size={18} />
              <span className="text-xs font-semibold tracking-wider [writing-mode:vertical-rl]">CHI TIẾT · {cards[selected]?.title}</span>
            </button>
          )}
        </div>
        <section className={`area-log min-w-0 px-5 text-sm text-muted ${logOpen ? "py-4 lg:overflow-y-auto" : "py-2"}`}>
          <button
            type="button"
            onClick={() => setLogOpen(!logOpen)}
            className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-foreground"
          >
            Nhật ký {logOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <ul className={`space-y-1.5 ${logOpen ? "" : "hidden"}`}>
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

/** Tuỳ chọn hiển thị nhớ trong localStorage (lỗi / chế độ ẩn danh thì dùng mặc định). Server luôn render mặc định. */
const prefListeners = new Set<() => void>();
function readPref(key: string, initial: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? initial : v === "1";
  } catch {
    return initial;
  }
}
function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      prefListeners.add(cb);
      return () => prefListeners.delete(cb);
    },
    () => readPref(key, initial),
    () => initial,
  );
  const set = useCallback(
    (v: boolean) => {
      try {
        localStorage.setItem(key, v ? "1" : "0");
      } catch {
        /* bỏ qua */
      }
      prefListeners.forEach((l) => l());
    },
    [key],
  );
  return [value, set];
}
