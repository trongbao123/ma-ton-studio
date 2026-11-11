"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/** Ô tìm video: gõ tới đâu lọc tới đó (chờ 300ms sau phím cuối), giữ tab đang chọn, về trang 1. */
export function VideoSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const push = (q: string) => {
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    next.delete("page");
    const s = next.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  return (
    <div className="relative w-full sm:w-72" role="search">
      <Search size={16} className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${pending ? "animate-pulse text-sky-400" : "text-muted"}`} />
      <input
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => push(e.target.value), 300);
        }}
        placeholder="Tìm chương, tên truyện, số chương…"
        className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-4 text-sm outline-none placeholder:text-muted focus:border-zinc-500"
      />
    </div>
  );
}
