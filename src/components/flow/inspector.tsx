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
};

/** Bảng chi tiết của thẻ đang chọn: bên phải canvas (≥1024px) hoặc ngay dưới canvas trên màn hẹp. */
export function Inspector({ data, cards, selected }: Props) {
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
    <aside className="panel-text flex min-h-0 flex-col border-t border-border bg-[#141418] lg:border-l lg:border-t-0">
      <div className="px-6 pt-5">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-lg">
            <NodeIcon id={selected} brand={selected === "trends" ? null : view.ai?.brand} size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-bold">{view.title}</h3>
            <p className="text-sm text-muted">
              {CARD_STATE_TEXT[view.state]} · {view.subtitle}
              {view.warning && <span className="text-amber-400"> · {view.warning}</span>}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-1 border-b border-border text-sm">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3.5 py-2.5 ${tab === k ? "border-accent text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden px-6 py-6 lg:overflow-y-auto">
        <Panel data={data} tab={tab} />
      </div>
    </aside>
  );
}
