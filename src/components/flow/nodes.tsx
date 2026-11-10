"use client";

import { useState } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { YtStats } from "@/components/yt-stats";
import { BrandIcon, STEP_ICONS, type BrandId } from "@/components/brand-icons";
import { CARD_STATE_TEXT, type CardState, type CardView } from "@/lib/flow/model";
import { CARD_WIDTH } from "@/lib/flow/layout";
import { SUB_HEIGHT, SUB_WIDTH, type SubView } from "@/lib/flow/subnodes";

/** Màu nét icon từng bước — dễ phân biệt khi nhìn lướt canvas. */
const TINT: Record<string, string> = {
  trends: "text-emerald-300",
  thumbnail: "text-rose-300",
  long: "text-amber-300",
  short: "text-fuchsia-300",
  chapter: "text-amber-200",
  seo: "text-violet-300",
  tts: "text-sky-300",
  images: "text-pink-300",
  video: "text-amber-300",
};

/** Icon thẻ: logo hãng thật (YouTube, Claude, OpenAI, Gemini, Cloudflare) khi biết, không thì icon nét. */
export function NodeIcon({ id, brand, size = 30 }: { id: string; brand?: BrandId | null; size?: number }) {
  if (brand) return <BrandIcon id={brand} size={size} />;
  if (id === "youtube") return <BrandIcon id="youtube" size={size} />;
  const Icon = STEP_ICONS[id];
  return Icon ? <Icon size={size} strokeWidth={1.6} className={TINT[id]} /> : null;
}

const BORDER: Record<CardState, string> = {
  done: "border-emerald-600/80",
  run: "node-glow border-sky-400",
  error: "border-red-500 shadow-[0_0_0_5px_rgba(239,68,68,.12)]",
  quota: "border-amber-400/80 shadow-[0_0_0_5px_rgba(251,191,36,.10)]",
  wait: "border-[#34343e] opacity-70",
  idle: "border-[#34343e] border-dashed opacity-80",
  skip: "border-[#34343e] opacity-45",
};

const PILL: Record<CardState, string> = {
  done: "bg-emerald-500/15 text-emerald-300",
  run: "bg-sky-500/15 text-sky-300",
  error: "bg-red-500/15 text-red-300",
  quota: "bg-amber-500/15 text-amber-300",
  wait: "bg-zinc-500/15 text-zinc-300",
  idle: "bg-zinc-500/15 text-zinc-400",
  skip: "bg-zinc-500/10 text-zinc-500",
};

const DOT: Record<CardState, string> = { done: "✓", run: "●", error: "!", quota: "⏳", wait: "○", idle: "○", skip: "–" };

const handle = "!h-3 !w-3 !border-2 !border-[#0f0f13] !bg-[#6b6b78]";
const ring = (on?: boolean) => (on ? "outline outline-2 outline-offset-4 outline-amber-400" : "");

/** `row`: hàng của thẻ trong cây, dùng để hiện lần lượt từ trên xuống. */
export type CardNodeData = { view: CardView; selected?: boolean; row?: number };

/** Mỗi hàng trễ thêm 50ms khi vào trang lần đầu. */
const STAGGER_MS = 50;
/** Node con ra sau thẻ cha một nhịp. */
const SUB_DELAY_MS = 200;

/** Một thẻ trên hàng chính: icon, tên bước, AI thật đã làm, trạng thái và 1–2 chỉ số. */
export function CardNode({ data }: NodeProps<Node<CardNodeData>>) {
  const { view } = data;
  // Thẻ vừa chuyển sang "xong" thì tick nảy một lần (đổi key để chạy lại hoạt ảnh).
  const [prev, setPrev] = useState(view.state);
  const [tickKey, setTickKey] = useState(0);
  if (prev !== view.state) {
    setPrev(view.state);
    if (view.state === "done") setTickKey((k) => k + 1);
  }
  return (
    <div className="node-enter group relative cursor-pointer" style={{ width: CARD_WIDTH, animationDelay: `${(data.row ?? 0) * STAGGER_MS}ms` }}>
      <div
        className={`relative flex flex-col gap-2 rounded-2xl border-2 bg-gradient-to-br from-[#24242b] to-[#18181e] p-3 shadow-[0_8px_22px_rgba(0,0,0,.5)] transition-transform group-hover:-translate-y-0.5 ${BORDER[view.state]} ${ring(data.selected)}`}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.06]">
            <NodeIcon id={view.id} size={22} />
          </span>
          <b className="min-w-0 flex-1 truncate text-[15px] font-bold text-zinc-50">{view.title}</b>
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${PILL[view.state]}`}>
            <span key={tickKey} className={view.state === "run" ? "animate-pulse" : tickKey ? "tick-pop" : ""}>
              {DOT[view.state]}
            </span>
            {CARD_STATE_TEXT[view.state]}
          </span>
        </div>

        {view.ai && (
          <p className="flex items-center gap-1.5 text-[13px] text-zinc-300" title={`${view.ai.label}${view.ai.note ? ` (${view.ai.note})` : ""}`}>
            {view.ai.brand && <BrandIcon id={view.ai.brand} size={15} className="shrink-0" />}
            <span className="min-w-0 truncate">{view.ai.label}</span>
            {view.ai.note && <span className="shrink-0 text-xs text-amber-300/80">{view.ai.note}</span>}
          </p>
        )}

        {view.thumb && (
          // eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect, không tối ưu được bằng next/image
          <img src={view.thumb} alt="" width={216} height={72} loading="lazy" decoding="async" className="h-[72px] w-full rounded-lg object-cover ring-1 ring-white/10" />
        )}

        {view.id !== "thumbnail" && view.metrics.length > 0 && (
          <div className="space-y-0.5">
            {view.metrics.map((m, i) => (
              <p key={m} className={`truncate ${i === 0 ? "text-sm font-semibold text-zinc-100" : "text-[13px] text-zinc-400"}`} title={m}>
                {m}
              </p>
            ))}
          </div>
        )}

        {view.yt && (
          <div className="text-zinc-400">
            <YtStats longId={view.yt.longId} shortId={view.yt.shortId} large />
          </div>
        )}

        {view.id === "youtube" && view.chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {view.chips.map((c) => (
              <span key={c} className="max-w-full truncate rounded-full border border-white/10 bg-white/[.04] px-2 py-0.5 text-xs text-zinc-300">
                {c}
              </span>
            ))}
          </div>
        )}

        {view.links.length > 0 && (
          <div className="nodrag flex flex-wrap gap-x-3 text-[13px]">
            {view.links.map((l) => (
              <a key={l.label} href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} onClick={(e) => e.stopPropagation()} className="text-sky-400 underline">
                {l.label}
              </a>
            ))}
          </div>
        )}

        {view.progress != null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-400 transition-[width] duration-700 ease-out" style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>
        )}

        {view.warning && (
          <span title={view.warning} className="absolute -left-2 -top-2 grid h-6 w-6 place-items-center rounded-full border-2 border-[#0f0f13] bg-amber-400 text-xs font-bold text-black">
            !
          </span>
        )}
        {view.id !== "trends" && <Handle type="target" position={Position.Top} className={handle} isConnectable={false} />}
        <Handle id="tools" type="source" position={Position.Right} className={handle} isConnectable={false} />
        {view.id !== "youtube" && <Handle id="out" type="source" position={Position.Bottom} className={handle} isConnectable={false} />}
      </div>
    </div>
  );
}

export type SubNodeData = { view: SubView; row?: number };

/** Node con kiểu n8n: vòng tròn logo/icon + nhãn + model hoặc giá trị thật, nằm bên phải thẻ cha; mờ khi chưa có dữ liệu. */
export function SubNode({ data }: NodeProps<Node<SubNodeData>>) {
  const { view } = data;
  const Icon = STEP_ICONS[view.icon];
  return (
    <div
      className={`sub-enter flex items-center gap-2.5 rounded-full border bg-[#1a1a21] py-1 pl-1.5 pr-3 ${view.ok ? "border-emerald-700/50" : "border-dashed border-[#3d3d48] opacity-50"}`}
      style={{ width: SUB_WIDTH, height: SUB_HEIGHT, animationDelay: `${(data.row ?? 0) * STAGGER_MS + SUB_DELAY_MS}ms` }}
      title={`${view.label}: ${view.value}`}
    >
      <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 bg-[#23232b] ${view.ok ? "border-emerald-600/70" : "border-[#3d3d48]"}`}>
        {view.brand ? <BrandIcon id={view.brand} size={20} /> : Icon && <Icon size={18} strokeWidth={1.7} className="text-zinc-300" />}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <b className="block truncate text-[13px] font-semibold text-zinc-100">{view.label}</b>
        <span className="block truncate text-xs text-zinc-400">{view.value}</span>
      </span>
    </div>
  );
}

export const nodeTypes = { card: CardNode, sub: SubNode };
