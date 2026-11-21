import Link from "next/link";

export const HISTORY_TABS = [
  { id: "de-tai", label: "Đề tài & kịch bản" },
  { id: "reels", label: "Reels" },
  { id: "binh-luan", label: "Bình luận" },
  { id: "so-lieu", label: "Số liệu" },
] as const;
export type HistoryTab = (typeof HISTORY_TABS)[number]["id"];

/** Tab hợp lệ từ query `?tab=`; sai/thiếu → tab đề tài. */
export const historyTabOf = (raw: string | string[] | undefined): HistoryTab =>
  HISTORY_TABS.find((t) => t.id === raw)?.id ?? "de-tai";

/** Thanh tab dạng link (render phía server, không cần state client). */
export function HistoryTabs({ current }: { current: HistoryTab }) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border" aria-label="Mục quản lý kênh lịch sử">
      {HISTORY_TABS.map((t) => {
        const on = t.id === current;
        return (
          <Link
            key={t.id}
            href={`/lich-su?tab=${t.id}`}
            aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition-colors ${
              on ? "border-seal font-semibold text-foreground" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
