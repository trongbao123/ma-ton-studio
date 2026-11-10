"use client";

import { useState } from "react";
import { CARD_STATE_TEXT, type CardId, type CardView, type FlowData } from "@/lib/flow/model";
import { NodeIcon } from "./nodes";
import { PANELS, type Tab } from "./panels";

const TABS: [Tab, string][] = [
  ["out", "Kết quả"],
  ["in", "Đầu vào / Prompt"],
  ["log", "Nhật ký"],
];

type Props = {
  data: FlowData;
  cards: Record<CardId, CardView>;
  selected: CardId;
  /** Trên điện thoại inspector là bottom sheet — `open` là đang kéo lên. */
  open: boolean;
  onToggle: (open: boolean) => void;
};

export function Inspector({ data, cards, selected, open, onToggle }: Props) {
  const [tab, setTab] = useState<Tab>("out");
  const [shown, setShown] = useState(selected);
  // Đổi node thì về tab đầu.
  if (shown !== selected) {
    setShown(selected);
    setTab("out");
  }
  const view = cards[selected];
  const Panel = PANELS[selected];

  return (
    <aside
      className={`fixed inset-x-0 bottom-0 z-20 flex h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-[#141418] shadow-[0_-12px_40px_rgba(0,0,0,.6)] transition-transform duration-300 md:static md:z-auto md:h-auto md:min-h-0 md:translate-y-0 md:rounded-none md:border-l md:border-t-0 md:shadow-none ${
        open ? "translate-y-0" : "translate-y-[calc(100%-56px)]"
      }`}
    >
      <button type="button" onClick={() => onToggle(!open)} className="mx-auto mt-2 h-1 w-10 rounded-full bg-zinc-600 md:hidden" aria-label="Kéo lên / thu lại" />
      <div className="px-5 pt-2 md:pt-5">
        <div className="flex items-center gap-3" onClick={() => onToggle(true)}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border bg-card text-lg">
            <NodeIcon id={selected} brand={selected === "trends" ? null : view.ai?.brand} size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-bold">{view.title}</h3>
            <p className="truncate text-xs text-muted">
              {CARD_STATE_TEXT[view.state]} · {view.subtitle}
              {view.warning && <span className="text-amber-400"> · {view.warning}</span>}
            </p>
          </div>
          {open && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(false);
              }}
              className="text-muted hover:text-foreground md:hidden"
              aria-label="Thu lại"
            >
              ✕
            </button>
          )}
        </div>
        <div className="mt-4 flex gap-1 border-b border-border text-[13px]">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 ${tab === k ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">
        <Panel data={data} tab={tab} />
      </div>
    </aside>
  );
}
