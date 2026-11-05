import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { markPublishedAction, rerenderAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { db } from "@/db";
import { chapters, series, videos, type Video } from "@/db/schema";

const STATUS: Record<Video["status"], [string, string]> = {
  queued: ["Chờ render", "text-zinc-400"],
  rendering: ["Đang render…", "text-sky-500"],
  ready: ["Sẵn sàng đăng", "text-emerald-500"],
  failed: ["Lỗi", "text-red-500"],
  published: ["Đã đăng", "text-muted"],
};

export default function VideosPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Video</h1>
      <p className="text-sm text-muted">
        Tải video + thumbnail, upload lên YouTube Studio, dán tiêu đề/mô tả/tag, bật nhãn “nội dung đã chỉnh sửa/tổng hợp”, rồi bấm “Đã đăng”.
      </p>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <VideoList />
      </Suspense>
    </div>
  );
}

async function VideoList() {
  await connection();
  const rows = await db()
    .select({ v: videos, chapterNo: chapters.number, chapterTitle: chapters.title, chapterId: chapters.id, seriesTitle: series.title })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .innerJoin(series, eq(series.id, chapters.seriesId))
    .orderBy(desc(videos.id))
    .limit(50);

  if (!rows.length) return <p className="card text-muted">Chưa có video. Duyệt một chương là video tự render (10–20 phút).</p>;

  return (
    <ul className="space-y-4">
      {rows.map(({ v, chapterNo, chapterTitle, chapterId, seriesTitle }) => {
        const [label, tone] = STATUS[v.status];
        const file = (name: string) => (v.assets[name] ? `/api/videos/${v.id}/${name}` : null);
        return (
          <li key={v.id} className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link href={`/chapters/${chapterId}`} className="font-bold hover:text-accent">
                {seriesTitle} — Chương {chapterNo}: {chapterTitle}
              </Link>
              <span className={`text-sm font-medium ${tone}`}>
                {label}
                {v.durationSec ? ` · ${Math.round(v.durationSec / 60)} phút` : ""}
              </span>
            </div>

            {v.error && <p className="whitespace-pre-wrap text-xs text-red-500">{v.error.slice(0, 600)}</p>}
            {v.runUrl && (
              <a href={v.runUrl} target="_blank" className="text-xs text-muted underline">
                Xem log render
              </a>
            )}

            {v.meta && (
              <div className="space-y-2 text-sm">
                <p className="font-medium">{v.meta.title}</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["long.mp4", "⬇ Video dài"],
                    ["short.mp4", "⬇ Short"],
                    ["thumbnail.jpg", "⬇ Thumbnail"],
                  ].map(([name, text]) =>
                    file(name) ? (
                      <a key={name} href={file(name)!} className="btn-primary">
                        {text}
                      </a>
                    ) : null,
                  )}
                  <CopyButton text={v.meta.title} label="Copy tiêu đề" />
                  <CopyButton text={v.meta.description} label="Copy mô tả" />
                  <CopyButton text={v.meta.tags.join(", ")} label="Copy tag" />
                  <CopyButton text={`${v.meta.shortTitle}\n\n${v.meta.shortDescription}`} label="Copy tiêu đề Short" />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-3">
              {(v.status === "failed" || v.status === "ready" || v.status === "queued") && (
                <ActionForm action={rerenderAction.bind(null, v.id)} submitLabel="Render lại" variant="secondary" />
              )}
              {v.status === "ready" && (
                <ActionForm action={markPublishedAction.bind(null, v.id)} submitLabel="Đã đăng" className="flex flex-wrap items-center gap-2">
                  <input name="youtubeUrl" placeholder="Link YouTube (tuỳ chọn)" className="field w-64" />
                </ActionForm>
              )}
              {v.youtubeUrl && (
                <a href={v.youtubeUrl} target="_blank" className="text-sm underline">
                  Xem trên YouTube
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
