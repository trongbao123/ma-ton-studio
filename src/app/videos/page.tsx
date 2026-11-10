import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { VideoTile } from "@/components/studio-cards";
import type { Video } from "@/db/schema";
import { videoCards } from "@/lib/studio";
import { readStatsSnapshot } from "@/lib/youtube-stats";

const FILTERS: { id: string; label: string; statuses?: Video["status"][] }[] = [
  { id: "all", label: "Tất cả" },
  { id: "running", label: "Đang làm", statuses: ["queued", "rendering"] },
  { id: "ready", label: "Chờ đăng", statuses: ["ready"] },
  { id: "published", label: "Đã đăng", statuses: ["published"] },
  { id: "failed", label: "Lỗi", statuses: ["failed"] },
];

export default function VideosPage({ searchParams }: PageProps<"/videos">) {
  return (
    <div className="space-y-8">
      <header className="space-y-5">
        <h1 className="font-serif text-3xl font-extrabold sm:text-4xl">Video</h1>
        <Suspense fallback={<div className="h-9" />}>
          <Tabs searchParams={searchParams} />
        </Suspense>
      </header>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <Grid searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function current(searchParams: PageProps<"/videos">["searchParams"]) {
  const f = (await searchParams).loc;
  return FILTERS.find((x) => x.id === f) ?? FILTERS[0];
}

async function Tabs({ searchParams }: { searchParams: PageProps<"/videos">["searchParams"] }) {
  const on = await current(searchParams);
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Lọc video">
      {FILTERS.map((f) => (
        <Link
          key={f.id}
          href={f.id === "all" ? "/videos" : `/videos?loc=${f.id}`}
          aria-current={f.id === on.id ? "page" : undefined}
          className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
            f.id === on.id ? "border-foreground/30 bg-white/[.08] font-medium text-foreground" : "border-border text-muted hover:text-foreground"
          }`}
        >
          {f.label}
        </Link>
      ))}
    </nav>
  );
}

async function Grid({ searchParams }: { searchParams: PageProps<"/videos">["searchParams"] }) {
  await connection();
  const f = await current(searchParams);
  const [list, stats] = await Promise.all([videoCards({ statuses: f.statuses }), readStatsSnapshot()]);
  if (!list.length)
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted">
        {f.id === "all" ? "Chưa có video. Duyệt một chương là video tự render (10–20 phút)." : "Không có video nào ở mục này."}
      </p>
    );
  return (
    <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {list.map((v) => (
        <li key={v.id}>
          <VideoTile v={v} snapshot={stats.videos} />
        </li>
      ))}
    </ul>
  );
}
