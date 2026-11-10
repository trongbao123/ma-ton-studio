import { CircleAlert, Clock3, Loader2, Radio, Upload } from "lucide-react";
import Link from "next/link";
import { BrandIcon } from "@/components/brand-icons";
import { formatSlot, STATUS_LABEL } from "@/lib/flow/model";
import type { SeriesCard, VideoCard } from "@/lib/studio";

/**
 * Bìa truyện kiểu bìa sách: ảnh thumbnail video mới nhất làm nền, tên truyện serif đè dưới,
 * thanh tiến độ duyệt chương. Chưa có video thì dùng nền mực với con dấu.
 */
export function SeriesCover({ s }: { s: SeriesCard }) {
  const pct = s.total ? s.approved / s.total : 0;
  return (
    <Link
      href={`/series/${s.id}`}
      className="group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-2xl border border-border bg-[#14151c] focus-visible:outline-offset-4"
    >
      {s.coverVideoId ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh từ GitHub Release qua redirect
        <img
          src={`/api/videos/${s.coverVideoId}/thumbnail.jpg`}
          alt=""
          loading="lazy"
          className="absolute inset-x-0 top-0 h-[128%] w-full object-cover object-top transition-transform duration-700 group-hover:scale-[1.04]"
        />
      ) : (
        <span aria-hidden className="absolute inset-0 grid place-items-center font-serif text-[9rem] font-black text-seal/15">
          魔
        </span>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0b0c10] from-30% via-[#0b0c10]/75 via-55% to-transparent" />
      {s.autopilot && (
        <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-jade backdrop-blur">
          <Radio size={12} /> Tự viết
        </span>
      )}
      <div className="relative space-y-3 p-5">
        <p className="text-xs text-muted">{s.genre}</p>
        <h3 className="font-serif text-xl font-extrabold leading-snug text-[#f3efe4] [text-wrap:balance]">{s.title}</h3>
        <div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-jade" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <p className="mt-2 flex justify-between text-xs text-muted">
            <span>
              {s.approved}/{s.total} chương đã duyệt
            </span>
            {s.pending > 0 && <span className="font-medium text-gold">{s.pending} chờ duyệt</span>}
          </p>
        </div>
      </div>
    </Link>
  );
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** Trạng thái thẻ video bằng lời + icon, đặt dưới ảnh để không đè chữ trên thumbnail. */
function VideoState({ v }: { v: VideoCard }) {
  if (v.status === "rendering")
    return (
      <span className="flex items-center gap-1.5 text-sky-300">
        <Loader2 size={13} className="animate-spin" /> {v.live ?? "Đang render"}
      </span>
    );
  if (v.uploadStatus === "uploading")
    return (
      <span className="flex items-center gap-1.5 text-sky-300">
        <Upload size={13} /> Đang upload YouTube
      </span>
    );
  if (v.status === "failed" || v.uploadStatus === "failed")
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-red-400">
        <CircleAlert size={13} className="shrink-0" /> <span className="truncate">{v.status === "failed" ? "Render lỗi" : "Upload YouTube lỗi"}</span>
      </span>
    );
  if (v.uploadStatus === "scheduled" && v.publishAt)
    return (
      <span className="flex items-center gap-1.5 text-jade">
        <BrandIcon id="youtube" size={13} /> Lên lịch {formatSlot(v.publishAt)}
      </span>
    );
  if (v.status === "ready")
    return (
      <span className="flex items-center gap-1.5 text-gold">
        <Clock3 size={13} /> {v.publishAt ? `Chờ đăng ${formatSlot(v.publishAt)}` : "Chờ đăng"}
      </span>
    );
  return <span className="text-muted">{STATUS_LABEL[v.status][0]}</span>;
}

export function VideoTile({ v }: { v: VideoCard }) {
  return (
    <Link href={`/videos/${v.id}`} className="group block focus-visible:outline-offset-4">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-[#14151c]">
        {v.hasThumb ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh từ GitHub Release qua redirect
          <img src={`/api/videos/${v.id}/thumbnail.jpg`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="absolute inset-0 grid place-items-center font-serif text-4xl font-extrabold text-white/15">{v.compilation ? `Chương ${v.compilation.from}–${v.compilation.to}` : `Chương ${v.chapterNo}`}</span>
        )}
        {v.durationSec ? <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold">{clock(v.durationSec)}</span> : null}
        {v.pct != null && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-sky-400 transition-[width] duration-700" style={{ width: `${Math.round(v.pct * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <p className="truncate text-xs text-muted">{v.seriesTitle}</p>
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug group-hover:text-white">
          {v.compilation ? `Bản gộp chương ${v.compilation.from}–${v.compilation.to}` : `Chương ${v.chapterNo}: ${v.chapterTitle}`}
        </p>
        <div className="text-xs">
          <VideoState v={v} />
        </div>
      </div>
    </Link>
  );
}
