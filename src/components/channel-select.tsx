"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState, useTransition } from "react";
import { setViewChannelAction } from "@/app/actions";

type Option = { key: string; name: string };

/** Danh sách kênh để lọc web: "Tất cả" + từng kênh. Đổi xong server tự vẽ lại trang theo kênh mới. */
export function ChannelSelect({ options, current }: { options: Option[]; current: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const all = [{ key: "all", name: "Tất cả kênh" }, ...options];
  const label = all.find((o) => o.key === current)?.name ?? "Tất cả kênh";
  const pick = (key: string) => {
    setOpen(false);
    if (key !== current) start(() => setViewChannelAction(key));
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-left text-sm hover:border-zinc-600"
      >
        <span className="min-w-0">
          <span className="block text-[11px] uppercase tracking-wide text-muted">Kênh</span>
          <span className={`block truncate font-medium ${pending ? "opacity-60" : ""}`}>{label}</span>
        </span>
        <ChevronsUpDown size={15} className="shrink-0 text-muted" />
      </button>
      {open && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-sidebar py-1 shadow-xl">
          {all.map((o) => (
            <li key={o.key}>
              <button
                type="button"
                role="option"
                aria-selected={o.key === current}
                onClick={() => pick(o.key)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-white/[.05]"
              >
                <span className="truncate">{o.name}</span>
                {o.key === current && <Check size={14} className="shrink-0 text-seal" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
