import Link from "next/link";
import { LiveRefresh } from "@/components/live-refresh";
import { connection } from "next/server";
import { Suspense } from "react";
import { VideoTile } from "@/components/studio-cards";
import { VideoSearch } from "@/components/video-search";
import type { Video } from "@/db/schema";
import { pageList } from "@/lib/paging";
import { videoCards, videoCount, type VideoKind } from "@/lib/studio";
import { readStatsSnapshot } from "@/lib/youtube-stats";
import { viewChannel } from "@/lib/channel-filter";

const FILTERS: { id: string; label: string; statuses?: Video["status"][]; kind?: VideoKind }[] = [
  { id: "all", label: "Tất cả" },
  { id: "episode", label: "Tập", kind: "episode" },
  { id: "short", label: "Short", kind: "short" },
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
        <Suspense fallback={null}>
          <YoutubeNotice searchParams={searchParams} />
        </Suspense>
        <Suspense fallback={<div className="h-9" />}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs searchParams={searchParams} />
            <VideoSearch />
          </div>
        </Suspense>
      </header>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <Grid searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const YT_NOTICE: Record<string, { tone: string; text: string }> = {
  connected: { tone: "text-emerald-400", text: "Đã kết nối kênh YouTube." },
  error: { tone: "text-rose-400", text: "Kết nối YouTube lỗi — thử lại." },
  "wrong-channel": {
    tone: "text-rose-400",
    text: "Chọn nhầm kênh ở màn Google (vd kênh cá nhân mang tên mình thay vì kênh Chuyện Đời Lắng Đọng) — bấm kết nối lại và chọn đúng kênh trong danh sách tài khoản.",
  },
};

/** Kết quả quay về từ /api/youtube/callback (?youtube=…). */
async function YoutubeNotice({ searchParams }: { searchParams: PageProps<"/videos">["searchParams"] }) {
  const v = (await searchParams).youtube;
  const n = YT_NOTICE[Array.isArray(v) ? v[0] : (v ?? "")];
  return n ? <p className={`text-sm ${n.tone}`}>{n.text}</p> : null;
}

const PAGE_SIZE = 8;

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
  const filter = { statuses: f.statuses, kind: f.kind, q, channel: await viewChannel() };
  const [list, total, stats] = await Promise.all([
    videoCards({ ...filter, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    videoCount(filter),
    readStatsSnapshot(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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
      {pages > 1 && (
        <nav className="flex flex-wrap items-center justify-center gap-1.5 pt-2 text-sm" aria-label="Phân trang">
          <PageLink to={href(f.id, q, page - 1)} off={page <= 1}>
            ←
          </PageLink>
          {pageList(page, pages).map((p, i) =>
            p === null ? (
              <span key={`gap${i}`} className="px-1 text-muted">
                …
              </span>
            ) : (
              <PageLink key={p} to={href(f.id, q, p)} on={p === page}>
                {p}
              </PageLink>
            ),
          )}
          <PageLink to={href(f.id, q, page + 1)} off={page >= pages}>
            →
          </PageLink>
          <span className="ml-2 text-xs text-muted">{total} video</span>
        </nav>
      )}
    </>
  );
}

function PageLink({ to, on, off, children }: { to: string; on?: boolean; off?: boolean; children: React.ReactNode }) {
  const cls = "grid h-9 min-w-9 place-items-center rounded-full border px-3 tabular-nums";
  if (off) return <span className={`${cls} border-border opacity-30`}>{children}</span>;
  return (
    <Link href={to} aria-current={on ? "page" : undefined} className={`${cls} ${on ? "border-foreground/40 bg-white/[.08] font-semibold" : "border-border text-muted hover:border-zinc-500 hover:text-foreground"}`}>
      {children}
    </Link>
  );
}
