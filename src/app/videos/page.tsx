import { Search } from "lucide-react";
import Link from "next/link";
import { LiveRefresh } from "@/components/live-refresh";
import { connection } from "next/server";
import { Suspense } from "react";
import { VideoTile } from "@/components/studio-cards";
import type { Video } from "@/db/schema";
import { videoCards, type VideoKind } from "@/lib/studio";
import { readStatsSnapshot } from "@/lib/youtube-stats";

const FILTERS: { id: string; label: string; statuses?: Video["status"][]; kind?: VideoKind }[] = [
  { id: "all", label: "Tất cả" },
  { id: "episode", label: "Tập", kind: "episode" },
  { id: "internal", label: "Chương (nội bộ)", kind: "internal" },
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs searchParams={searchParams} />
            <SearchBox searchParams={searchParams} />
          </div>
        </Suspense>
      </header>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <Grid searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const PAGE_SIZE = 24;

async function current(searchParams: PageProps<"/videos">["searchParams"]) {
  const f = (await searchParams).loc;
  return FILTERS.find((x) => x.id === f) ?? FILTERS[0];
}

/** Đọc q (tìm kiếm) và page (trang, từ 1) từ URL. */
async function query(searchParams: PageProps<"/videos">["searchParams"]) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).slice(0, 80);
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  return { q, page };
}

/** URL giữ bộ lọc + tìm kiếm, đổi trang. */
function href(loc: string, q: string, page = 1) {
  const p = new URLSearchParams();
  if (loc !== "all") p.set("loc", loc);
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/videos?${s}` : "/videos";
}

/** Ô tìm kiếm: form GET thường (không cần JS), giữ tab đang chọn. */
async function SearchBox({ searchParams }: { searchParams: PageProps<"/videos">["searchParams"] }) {
  const [on, { q }] = await Promise.all([current(searchParams), query(searchParams)]);
  return (
    <form action="/videos" className="relative w-full sm:w-72" role="search">
      {on.id !== "all" && <input type="hidden" name="loc" value={on.id} />}
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        name="q"
        defaultValue={q}
        placeholder="Tìm chương, tên truyện, số chương…"
        className="w-full rounded-full border border-border bg-card py-2 pl-9 pr-4 text-sm outline-none placeholder:text-muted focus:border-zinc-500"
      />
    </form>
  );
}

async function Tabs({ searchParams }: { searchParams: PageProps<"/videos">["searchParams"] }) {
  const on = await current(searchParams);
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Lọc video">
      {FILTERS.map((f) => (
        <Link
          key={f.id}
          href={href(f.id, "")}
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
  const [f, { q, page }] = await Promise.all([current(searchParams), query(searchParams)]);
  // Lấy dư 1 thẻ để biết còn trang sau không (khỏi đếm tổng).
  const [rows, stats] = await Promise.all([
    videoCards({ statuses: f.statuses, kind: f.kind, q, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }),
    readStatsSnapshot(),
  ]);
  const hasNext = rows.length > PAGE_SIZE;
  const list = rows.slice(0, PAGE_SIZE);
  if (!list.length)
    return (
      <p className="rounded-xl border border-dashed border-border p-10 text-center text-muted">
        {q ? `Không tìm thấy video nào cho “${q}”.` : f.id === "all" ? "Chưa có video. Duyệt một chương là video tự render (10–20 phút)." : "Không có video nào ở mục này."}
      </p>
    );
  return (
    <>
      <LiveRefresh initial={stats.metaAt} />
      <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {list.map((v) => (
          <li key={v.id}>
            <VideoTile v={v} snapshot={stats.videos} />
          </li>
        ))}
      </ul>
      {(page > 1 || hasNext) && (
        <nav className="flex items-center justify-center gap-3 pt-2 text-sm" aria-label="Phân trang">
          {page > 1 ? (
            <Link href={href(f.id, q, page - 1)} className="rounded-full border border-border px-4 py-1.5 hover:border-zinc-500">
              ← Trang trước
            </Link>
          ) : (
            <span className="rounded-full border border-border px-4 py-1.5 opacity-40">← Trang trước</span>
          )}
          <span className="tabular-nums text-muted">Trang {page}</span>
          {hasNext ? (
            <Link href={href(f.id, q, page + 1)} className="rounded-full border border-border px-4 py-1.5 hover:border-zinc-500">
              Trang sau →
            </Link>
          ) : (
            <span className="rounded-full border border-border px-4 py-1.5 opacity-40">Trang sau →</span>
          )}
        </nav>
      )}
    </>
  );
}
