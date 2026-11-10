import type { Lamp as LampState } from "@/lib/ai/sources";

/** Đèn trạng thái: ngọc = đang dùng, vàng = có model hết lượt (đang chạy dự phòng), đỏ chu sa = dừng hẳn, xám = chưa dùng / chưa kết nối. */
export function Lamp({ lamp, className = "" }: { lamp: LampState; className?: string }) {
  const tone =
    lamp === "limited"
      ? "bg-seal shadow-[0_0_0_3px_rgba(210,70,59,.18)]"
      : lamp === "partial"
        ? "bg-gold shadow-[0_0_0_3px_rgba(212,168,75,.18)]"
        : lamp === "active"
        ? "bg-jade shadow-[0_0_0_3px_rgba(79,179,154,.16)]"
        : lamp === "idle"
          ? "bg-zinc-500"
          : "border border-zinc-600 bg-transparent";
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone} ${className}`} />;
}
