import type { Chapter } from "@/db/schema";

const LABEL: Record<Chapter["status"], [string, string]> = {
  outline: ["Dàn ý", "bg-zinc-500/15 text-zinc-400"],
  draft: ["Chờ duyệt", "bg-amber-500/15 text-amber-500"],
  approved: ["Đã duyệt", "bg-emerald-500/15 text-emerald-500"],
};

export function StatusBadge({ status }: { status: Chapter["status"] }) {
  const [label, tone] = LABEL[status];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{label}</span>;
}
