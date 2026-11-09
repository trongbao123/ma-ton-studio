"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { BrandIcon, STEP_ICONS, type BrandId } from "@/components/brand-icons";
import type { NodeId, StepState, StepView } from "@/lib/flow/model";

/** Màu nét icon từng bước — dễ phân biệt khi nhìn lướt canvas. */
const TINT: Record<string, string> = {
  trigger: "text-emerald-300",
  agent: "text-violet-300",
  tts: "text-sky-300",
  images: "text-pink-300",
  video: "text-amber-300",
  bible: "text-amber-200",
  summary: "text-zinc-300",
  label: "text-rose-300",
  model: "text-violet-300",
  vidiq: "text-emerald-300",
};

/** Icon node: logo hãng thật (YouTube, Claude, OpenAI, Gemini, Cloudflare) khi biết, không thì icon nét. */
export function NodeIcon({ id, brand, size = 30 }: { id: string; brand?: BrandId | null; size?: number }) {
  if (brand) return <BrandIcon id={brand} size={size} />;
  if (id === "youtube") return <BrandIcon id="youtube" size={size} />;
  const Icon = STEP_ICONS[id];
  return Icon ? <Icon size={size} strokeWidth={1.6} className={TINT[id]} /> : null;
}

const BORDER: Record<StepState, string> = {
  done: "border-emerald-600/80",
  run: "border-sky-400 shadow-[0_0_0_6px_rgba(56,189,248,.12),0_0_30px_rgba(56,189,248,.25)]",
  error: "border-red-500 shadow-[0_0_0_5px_rgba(239,68,68,.12)]",
  wait: "border-[#34343e] opacity-60",
  skip: "border-[#34343e] opacity-40",
};

const BADGE: Partial<Record<StepState, [string, string]>> = {
  done: ["bg-emerald-500", "✓"],
  run: ["bg-sky-500 animate-pulse", "…"],
  error: ["bg-red-500", "!"],
};

const handle = "!h-2.5 !w-2.5 !border-2 !border-[#0f0f13] !bg-[#55555f]";

export type StepNodeData = { view: StepView; selected?: boolean; brand?: BrandId | null };
export type SubNodeData = { id: string; title: string; subtitle: string; brand?: BrandId | null };

function Badge({ view }: { view: StepView }) {
  const b = BADGE[view.state];
  return (
    <>
      {b && (
        <span className={`absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full border-2 border-[#0f0f13] px-1 text-[10px] font-bold text-white ${b[0]}`}>
          {b[1]}
        </span>
      )}
      {view.warning && (
        <span title={view.warning} className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full border-2 border-[#0f0f13] bg-amber-400 text-[10px] font-bold text-black">
          !
        </span>
      )}
    </>
  );
}

const ring = (on?: boolean) => (on ? "outline outline-2 outline-offset-4 outline-amber-400" : "");
const box =
  "relative flex items-center justify-center rounded-2xl border-[1.5px] bg-gradient-to-br from-[#24242b] to-[#18181e] shadow-[0_8px_22px_rgba(0,0,0,.5)] transition-transform group-hover:-translate-y-0.5";

export function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { view } = data;
  const first = view.id === "trigger";
  return (
    <div className="group relative w-[84px] cursor-pointer">
      <div className={`${box} h-[84px] w-[84px] text-3xl ${BORDER[view.state]} ${ring(data.selected)}`}>
        <NodeIcon id={view.id} brand={data.brand} />
        <Badge view={view} />
        {!first && <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />}
        <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
        {hasSub(view.id) && <Handle id="sub" type="source" position={Position.Bottom} className={handle} isConnectable={false} />}
        {view.progress != null && <Bar value={view.progress} />}
      </div>
      <Label title={view.title} subtitle={view.subtitle} tone={view.state} />
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="absolute inset-x-2.5 bottom-2 h-1 overflow-hidden rounded-full bg-zinc-800">
      <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-violet-400 transition-[width] duration-700" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

const hasSub = (id: NodeId) => id === "images" || id === "youtube";

export const AGENT_SLOTS = [
  { id: "model", label: "Model*" },
  { id: "memory", label: "Memory" },
  { id: "tool", label: "Tool" },
] as const;

export function AgentNode({ data }: NodeProps<Node<StepNodeData>>) {
  const { view } = data;
  return (
    <div className="group relative w-[230px] cursor-pointer">
      <div
        className={`${box} h-[104px] w-[230px] justify-start gap-3 px-5 pb-4 text-[28px] ${
          view.state === "done" ? "border-violet-500/80" : BORDER[view.state]
        } from-[#2a2140] to-[#19171f] ${ring(data.selected)}`}
      >
        <NodeIcon id="agent" brand={data.brand} size={30} />
        <div className="min-w-0 text-left">
          <b className="block text-sm text-zinc-100">AI Agent</b>
          <small className="block truncate text-xs text-violet-300">Đạo diễn · {view.subtitle}</small>
        </div>
        <Badge view={view} />
        <div className="pointer-events-none absolute inset-x-0 bottom-1.5 flex justify-around text-[10px] text-violet-200/55">
          {AGENT_SLOTS.map((s) => (
            <span key={s.id}>{s.label}</span>
          ))}
        </div>
        <Handle type="target" position={Position.Left} className={handle} isConnectable={false} />
        <Handle type="source" position={Position.Right} className={handle} isConnectable={false} />
        {AGENT_SLOTS.map((s, i) => (
          <Handle
            key={s.id}
            id={s.id}
            type="source"
            position={Position.Bottom}
            style={{ left: `${((i * 2 + 1) / 6) * 100}%` }}
            className="!h-2.5 !w-2.5 !rotate-45 !rounded-none !border-2 !border-[#0f0f13] !bg-violet-500"
            isConnectable={false}
          />
        ))}
        {view.progress != null && (
          <div className="absolute inset-x-5 bottom-3 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-violet-400 transition-[width] duration-700" style={{ width: `${Math.round(view.progress * 100)}%` }} />
          </div>
        )}
      </div>

    </div>
  );
}

export function SubNode({ data }: NodeProps<Node<SubNodeData>>) {
  return (
    <div className="group relative w-[52px] cursor-pointer">
      <div className="relative grid h-[52px] w-[52px] place-items-center rounded-full border-[1.5px] border-[#3a3a44] bg-[#1a1a20] text-xl shadow-[0_6px_16px_rgba(0,0,0,.45)] transition-transform group-hover:-translate-y-0.5">
        <NodeIcon id={data.id} brand={data.brand} size={22} />
        <Handle type="target" position={Position.Top} className={handle} isConnectable={false} />
      </div>
      <div className="pointer-events-none absolute left-1/2 top-full mt-2 w-[80px] -translate-x-1/2 text-center leading-tight">
        <b className="block truncate text-[11.5px] font-medium text-zinc-300">{data.title}</b>
        <span className="block truncate text-[10.5px] text-zinc-500">{data.subtitle}</span>
      </div>
    </div>
  );
}

function Label({ title, subtitle, tone }: { title: string; subtitle: string; tone: StepState }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-full mt-2.5 w-[150px] -translate-x-1/2 text-center leading-snug">
      <b className="block truncate text-[12.5px] font-semibold text-zinc-100">{title}</b>
      <span className={`block truncate text-[11px] ${tone === "run" ? "text-sky-300" : tone === "error" ? "text-red-400" : "text-zinc-500"}`}>
        {subtitle}
      </span>
    </div>
  );
}

export const nodeTypes = { step: StepNode, agent: AgentNode, sub: SubNode };
