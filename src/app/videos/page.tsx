import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { formatSlot, STATUS_LABEL } from "@/lib/flow/model";

export default function VideosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Video</h1>
        <p className="mt-1 text-sm text-muted">Bấm vào video để xem flow: ảnh, video, lịch đăng và các nút đăng tay.</p>
      </div>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <VideoGrid />
      </Suspense>
    </div>
  );
}

async function VideoGrid() {
  await connection();
  const rows = await db()
    .select({ v: videos, chapterNo: chapters.number, chapterTitle: chapters.title, seriesTitle: series.title })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .orderBy(desc(videos.id))
    .limit(50);

  if (!rows.length) return <p className="card text-muted">Chưa có video. Duyệt một chương là video tự render (10–20 phút).</p>;

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(({ v, chapterNo, chapterTitle, seriesTitle }) => {
        const [label, tone] = STATUS_LABEL[v.status];
        return (
          <li key={v.id}>
            <Link href={`/videos/${v.id}`} className="group block overflow-hidden rounded-xl border border-border bg-card transition hover:border-accent">
              <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-red-950 to-slate-950">
                {v.assets["thumbnail.jpg"] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect, không tối ưu được bằng next/image
                  <img src={`/api/videos/${v.id}/thumbnail.jpg`} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                ) : (
                  <span className="absolute inset-0 grid place-items-center text-3xl font-bold text-white/70">Ch. {chapterNo}</span>
                )}
                <span className={`absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold backdrop-blur ${tone}`}>{label}</span>
                {v.durationSec && (
                  <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 text-[11px] font-semibold text-white">
                    {Math.floor(v.durationSec / 60)}:{String(v.durationSec % 60).padStart(2, "0")}
                  </span>
                )}
                {v.status === "rendering" && <span className="absolute inset-x-0 bottom-0 h-1 animate-pulse bg-sky-400" />}
              </div>
              <div className="space-y-1 p-3">
                <p className="truncate text-xs text-muted">{seriesTitle}</p>
                <p className="line-clamp-2 text-sm font-semibold">
                  Chương {chapterNo}: {chapterTitle}
                </p>
                {v.publishAt && v.status === "ready" && <p className="text-xs text-amber-500">📅 {formatSlot(v.publishAt.toISOString())}</p>}
                {v.status === "failed" && v.error && <p className="truncate text-xs text-red-500">{v.error}</p>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
