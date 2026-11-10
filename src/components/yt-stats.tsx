"use client";

import { Eye, MessageCircle, ThumbsUp } from "lucide-react";
import { AnimatedCount } from "@/components/animated-count";
import { useLive } from "@/lib/live/store";
import type { YtStat } from "@/lib/live/types";

type Props = {
  longId: string | null;
  shortId: string | null;
  /** Số đã lưu từ server để hiện ngay trước khi SSE nối xong. */
  initial?: { long?: YtStat; short?: YtStat };
  /** Cỡ chữ lớn hơn cho bảng chi tiết. */
  large?: boolean;
};

function Row({ label, s, large }: { label: string | null; s: YtStat; large: boolean }) {
  const icon = large ? 14 : 12;
  return (
    <span className="inline-flex items-center gap-x-2.5 whitespace-nowrap">
      {label && <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>}
      <span className="inline-flex items-center gap-1" title="Lượt xem">
        <Eye size={icon} className="text-zinc-500" /> <AnimatedCount value={s.views} />
      </span>
      <span className="inline-flex items-center gap-1" title="Lượt thích">
        <ThumbsUp size={icon} className="text-zinc-500" /> <AnimatedCount value={s.likes} />
      </span>
      <span className="inline-flex items-center gap-1" title="Bình luận">
        <MessageCircle size={icon} className="text-zinc-500" /> <AnimatedCount value={s.comments} />
      </span>
    </span>
  );
}

/**
 * Lượt xem / thích / bình luận của video dài và Short, cập nhật theo luồng SSE (~mỗi phút).
 * Chưa có số (chưa kết nối YouTube, hết quota, video chưa đăng) → không hiện gì, không báo lỗi.
 */
export function YtStats({ longId, shortId, initial, large = false }: Props) {
  const { stats } = useLive();
  const long = (longId && stats?.videos[longId]) || initial?.long;
  const short = (shortId && stats?.videos[shortId]) || initial?.short;
  if (!long && !short) return null;
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1 text-muted ${large ? "text-sm" : "text-xs"}`} title="Số liệu YouTube, cập nhật mỗi phút">
      {long && <Row label={short ? "Video" : null} s={long} large={large} />}
      {short && <Row label="Short" s={short} large={large} />}
    </div>
  );
}
