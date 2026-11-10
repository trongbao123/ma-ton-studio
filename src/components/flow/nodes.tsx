"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { BrandIcon, STEP_ICONS, type BrandId } from "@/components/brand-icons";
import { CARD_STATE_TEXT, type CardState, type CardView } from "@/lib/flow/model";
import { CARD_WIDTH } from "@/lib/flow/layout";

/** Màu nét icon từng bước — dễ phân biệt khi nhìn lướt canvas. */
const TINT: Record<string, string> = {
  trends: "text-emerald-300",
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
  run: "border-sky-400 shadow-[0_0_0_6px_rgba(56,189,248,.12),0_0_30px_rgba(56,189,248,.25)]",
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

const handle = "!h-2.5 !w-2.5 !border-2 !border-[#0f0f13] !bg-[#55555f]";
const ring = (on?: boolean) => (on ? "outline outline-2 outline-offset-4 outline-amber-400" : "");

export type CardNodeData = { view: CardView; selected?: boolean };

/** Một thẻ trên hàng chính: icon, tên bước, AI thật đã làm, trạng thái và 1–2 chỉ số. */
export function CardNode({ data }: NodeProps<Node<CardNodeData>>) {
  const { view } = data;
  return (
    <div className="group relative cursor-pointer" style={{ width: CARD_WIDTH }}>
      <div
        className={`relative flex flex-col gap-2 rounded-2xl border-[1.5px] bg-gradient-to-br from-[#24242b] to-[#18181e] p-3 shadow-[0_8px_22px_rgba(0,0,0,.5)] transition-transform group-hover:-translate-y-0.5 ${BORDER[view.state]} ${ring(data.selected)}`}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.05]">
            <NodeIcon id={view.id} size={18} />
          </span>
          <b className="min-w-0 flex-1 truncate text-[13px] font-semibold text-zinc-100">{view.title}</b>
        </div>

        <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${PILL[view.state]}`}>
          <span className={view.state === "run" ? "animate-pulse" : ""}>{DOT[view.state]}</span>
          {CARD_STATE_TEXT[view.state]}
        </span>

        <p className="flex min-h-[18px] items-center gap-1.5 text-[11px] text-zinc-300" title={view.ai ? `${view.ai.label}${view.ai.note ? ` (${view.ai.note})` : ""}` : "chưa ghi AI"}>
          {view.ai?.brand && <BrandIcon id={view.ai.brand} size={13} className="shrink-0" />}
          <span className="min-w-0 truncate">{view.ai ? view.ai.label : "—"}</span>
          {view.ai?.note && <span className="shrink-0 text-[9.5px] text-amber-300/80">{view.ai.note}</span>}
        </p>

        {view.thumb && (
          // eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect, không tối ưu được bằng next/image
          <img src={view.thumb} alt="" loading="lazy" className="aspect-video w-full rounded-md object-cover ring-1 ring-white/10" />
        )}

        <div className="space-y-0.5">
          {view.metrics.map((m) => (
            <p key={m} className="truncate text-[11.5px] text-zinc-400" title={m}>
              {m}
            </p>
          ))}
        </div>

        {view.chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {view.chips.map((c) => (
              <span key={c} className="max-w-full truncate rounded-full border border-white/10 bg-white/[.04] px-1.5 py-px text-[10px] text-zinc-300">
                {c}
              </span>
            ))}
          </div>
        )}

        {view.links.length > 0 && (
          <div className="nodrag flex flex-wrap gap-x-2 text-[10.5px]">
            {view.links.map((l) => (
              <a key={l.label} href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} onClick={(e) => e.stopPropagation()} className="text-sky-400 underline">
                {l.label}
              </a>
            ))}
          </div>
        )}

        {view.progress != null && (
          <div className="h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-400 transition-[width] duration-700" style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>
        )}

        {view.warning && (
          <span title={view.warning} className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full border-2 border-[#0f0f13] bg-amber-400 text-[10px] font-bold text-black">
            !
          </span>
        )}
        {view.id !== "trends" && <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />}
        {view.id !== "youtube" && <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />}
      </div>
    </div>
  );
}

export const nodeTypes = { card: CardNode };
