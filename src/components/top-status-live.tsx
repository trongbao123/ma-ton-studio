"use client";

import { ExternalLink, Eye } from "lucide-react";
import Link from "next/link";
import { AnimatedCount } from "@/components/animated-count";
import { BrandIcon } from "@/components/brand-icons";
import { Lamp } from "@/components/usage-lamp";
import { LAMP_TEXT } from "@/lib/ai/sources";
import type { I2vStage } from "@/lib/flow/progress";
import { buildLamps } from "@/lib/live/lamps";
import { useLive } from "@/lib/live/store";
import type { ChannelStat, LiveStatus } from "@/lib/live/types";

const KAGGLE_STAGE_TEXT: Record<I2vStage, string> = { upload: "đang đẩy ảnh", queued: "chờ GPU", running: "đang tạo clip", download: "đang tạo clip", done: "xong" };

type Props = {
  /** Trạng thái server render lần đầu; SSE tới thì thay bằng bản mới. */
  initial: LiveStatus;
  initialChannelStat: ChannelStat | null;
  channel: string | null;
  channelUrl: string;
  /** Tổng view chỉ đo cho kênh gốc — đang xem kênh phụ thì ẩn để khỏi hiểu nhầm. */
  showViews?: boolean;
};

/** Phần tương tác của thanh trên cùng: video đang render, đèn AI, tổng view kênh — cập nhật realtime qua SSE. */
export function TopStatusLive({ initial, initialChannelStat, channel, channelUrl, showViews = true }: Props) {
  const live = useLive();
  const s = live.status ?? initial;
  const channelStat = live.stats?.channel ?? initialChannelStat;
  const lamps = buildLamps(s);
  const r = s.rendering;

  return (
    <div className="flex w-full items-center gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
        {r ? (
          <Link href={`/videos/${r.id}`} className="inline-flex max-w-full items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-sky-200 hover:bg-sky-500/15">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
            <span className="truncate">
              Đang render chương {r.number}
              {r.live ? ` · ${r.live}` : ""}
              {r.pct != null ? ` · ${Math.round(r.pct * 100)}%` : ""}
              {s.queued ? ` · còn ${s.queued} video chờ` : ""}
            </span>
          </Link>
        ) : s.queued ? (
          <Link href="/videos?loc=running" className="text-muted hover:text-foreground">
            {s.queued} video chờ render
          </Link>
        ) : (
          <span className="text-muted">Không có video đang làm</span>
        )}
        {s.kaggle && r && (
          <Link
            href={`/videos/${r.id}`}
            title="Clip động: ảnh → video 4–5 giây trên GPU free của Kaggle"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/15"
          >
            <BrandIcon id="kaggle" size={13} />
            <span>
              Kaggle: {KAGGLE_STAGE_TEXT[s.kaggle.stage]}
              {s.kaggle.total ? ` ${s.kaggle.done}/${s.kaggle.total}` : ""}
            </span>
          </Link>
        )}
      </div>
      <Link href="/usage" aria-label="Xem hạn mức AI" className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card/70 px-1.5 py-1 hover:border-zinc-600">
        {lamps.map((l) => (
          <span
            key={l.key}
            title={`${l.label}: ${LAMP_TEXT[l.lamp]} · ${l.calls}${l.limit ? `/${l.limit}` : ""} lượt hôm nay${l.note ? ` · ${l.note}` : ""}`}
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
          >
            <BrandIcon id={l.brand} size={13} />
            <span className="hidden xl:inline">{l.label}</span>
            {/* Đã dùng / hạn mức hôm nay (chỉ hiện "/N" khi hạn mức đo được). */}
            <span className="tabular-nums text-muted">
              {l.calls}
              {l.limit ? `/${l.limit}` : ""}
            </span>
            <Lamp lamp={l.lamp} />
          </span>
        ))}
      </Link>
      {showViews && channelStat && (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted sm:flex" title="Tổng lượt xem kênh · cập nhật mỗi phút (YouTube trễ vài phút)">
          <Eye size={13} />
          <AnimatedCount value={channelStat.views} className="text-foreground" />
        </span>
      )}
      <a
        href={channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={channel ? `Mở kênh ${channel} trên YouTube` : "Mở kênh YouTube (chưa kết nối để tự đăng)"}
        className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs hover:border-red-500/50 hover:text-white md:flex"
      >
        <BrandIcon id="youtube" size={14} />
        <span className={channel ? "" : "text-muted"}>{channel ?? "Chưa kết nối"}</span>
        <ExternalLink size={11} className="text-muted" />
      </a>
    </div>
  );
}
