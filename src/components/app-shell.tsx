"use client";

import { BookOpen, Clapperboard, Gauge, LayoutDashboard, LogOut, Menu, Plus, Sparkles, TrendingUp, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";

const NAV: { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/", label: "Xưởng truyện", icon: LayoutDashboard, match: (p) => p === "/" },
  { href: "/series", label: "Truyện", icon: BookOpen, match: (p) => p.startsWith("/series") || p.startsWith("/chapters") },
  { href: "/videos", label: "Video", icon: Clapperboard, match: (p) => p.startsWith("/videos") },
  { href: "/trends", label: "Xu hướng", icon: TrendingUp, match: (p) => p.startsWith("/trends") },
  { href: "/usage", label: "Hạn mức AI", icon: Gauge, match: (p) => p.startsWith("/usage") },
  { href: "/settings/ai", label: "Cài đặt AI", icon: Sparkles, match: (p) => p.startsWith("/settings") },
];

/** Con dấu chu sa — nhận diện kênh Ma Tôn Truyện. */
export function Seal({ size = 36 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      className="grid shrink-0 place-items-center rounded-[10px] bg-seal font-serif font-black text-[#fbe9e4] shadow-[inset_0_0_0_2px_rgba(255,255,255,.12),0_6px_18px_rgba(210,70,59,.35)]"
    >
      魔
    </span>
  );
}

/** Đường dẫn hiện tại là dữ liệu URL → phải nằm trong Suspense (cacheComponents); lúc chờ hiện menu không tô mục nào. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<Nav path="" onNavigate={onNavigate} />}>
      <ActiveNav onNavigate={onNavigate} />
    </Suspense>
  );
}

function ActiveNav({ onNavigate }: { onNavigate?: () => void }) {
  return <Nav path={usePathname()} onNavigate={onNavigate} />;
}

function Nav({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const on = match(path);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={on ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              on ? "bg-white/[.06] font-semibold text-foreground" : "text-muted hover:bg-white/[.03] hover:text-foreground"
            }`}
          >
            <Icon size={18} strokeWidth={1.8} className={on ? "text-seal" : ""} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Khung app: menu dọc bên trái trên máy tính, thanh trên + ngăn kéo trên điện thoại. Màn flow video tự phủ toàn màn hình. */
export function AppShell({ children, status }: { children: ReactNode; status?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const brand = (
    <Link href="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
      <Seal />
      <span className="leading-tight">
        <b className="block font-serif text-[15px]">Ma Tôn Studio</b>
        <span className="text-xs text-muted">kênh Ma Tôn Truyện</span>
      </span>
    </Link>
  );
  const newSeries = (
    <div className="space-y-2">
      <Link href="/series/new" onClick={() => setOpen(false)} className="btn-primary flex items-center justify-center gap-2">
        <Plus size={16} strokeWidth={2.2} /> Truyện mới
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground">
          <LogOut size={14} /> Đăng xuất
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-8 border-r border-border bg-sidebar px-4 py-6 lg:flex">
        {brand}
        <NavLinks />
        <div className="mt-auto">{newSeries}</div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-sidebar/95 px-4 py-3 backdrop-blur lg:hidden">
        {brand}
        <button type="button" onClick={() => setOpen(true)} aria-label="Mở menu" className="rounded-lg p-2 text-muted hover:text-foreground">
          <Menu size={22} />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" aria-label="Đóng menu" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col gap-8 border-r border-border bg-sidebar px-4 py-6">
            <div className="flex items-center justify-between">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Đóng menu" className="p-1 text-muted">
                <X size={20} />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <div className="mt-auto">{newSeries}</div>
          </div>
        </div>
      )}

      <div className="min-w-0">
        {/* Thanh trạng thái: dính trên cùng ở máy tính; trên điện thoại nằm ngay dưới thanh tiêu đề. */}
        {status && (
          <div className="flex min-h-14 items-center border-b border-border bg-background/85 px-4 py-2 backdrop-blur sm:px-8 lg:sticky lg:top-0 lg:z-10 lg:px-10">
            {status}
          </div>
        )}
        <main className="mx-auto w-full max-w-[1560px] px-4 py-8 sm:px-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
