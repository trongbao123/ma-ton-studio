import { desc, eq } from "drizzle-orm";
import { CircleAlert, FileClock } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { BrandIcon, brandOfModel } from "@/components/brand-icons";
import { SeriesCover, VideoTile } from "@/components/studio-cards";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { quotaDay } from "@/lib/ai/usage";
import { counters, seriesCards, todo, videoCards } from "@/lib/studio";

export default function HomePage() {
  return (
    <div className="space-y-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-extrabold sm:text-4xl">Xưởng truyện</h1>
          <Suspense fallback={<p className="mt-2 h-5" />}>
            <Counters />
          </Suspense>
        </div>
      </header>

      <Suspense fallback={null}>
        <Todo />
      </Suspense>

      <section className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Truyện của kênh</h2>
          <Link href="/series/new" className="text-sm text-muted hover:text-foreground">
            Tạo truyện mới
          </Link>
        </div>
        <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
          <Covers />
        </Suspense>
      </section>

      <section className="space-y-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Video gần đây</h2>
          <Link href="/videos" className="text-sm text-muted hover:text-foreground">
            Xem tất cả
          </Link>
        </div>
        <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
          <RecentVideos />
        </Suspense>
      </section>

      <Suspense fallback={null}>
        <UsageToday />
      </Suspense>
    </div>
  );
}

async function Counters() {
  await connection();
  const c = await counters();
  const items = [
    [c.drafts, "chương chờ duyệt", "text-gold"],
    [c.rendering, "video đang làm", "text-sky-300"],
    [c.ready, "video chờ đăng", "text-foreground"],
    [c.scheduled, "đã lên lịch YouTube", "text-jade"],
    [c.published, "đã đăng", "text-muted"],
  ] as const;
  return (
    <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
      {items.map(([n, label, tone]) => (
        <span key={label}>
          <b className={`text-base font-semibold ${tone}`}>{n}</b> {label}
        </span>
      ))}
    </p>
  );
}

/** Việc cần người dùng: chỉ hiện khi có — không có thì im lặng, không chiếm chỗ. */
async function Todo() {
  await connection();
  const { drafts, broken } = await todo();
  if (!drafts.length && !broken.length) return null;
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {drafts.length > 0 && (
        <div className="rounded-xl border border-gold/30 bg-gold/[.04] p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-gold">
            <FileClock size={18} /> Chương chờ bạn duyệt
          </h2>
          <ul className="divide-y divide-border/70">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/chapters/${d.id}`} className="flex items-baseline justify-between gap-4 py-2.5 text-sm hover:text-white">
                  <span className="min-w-0 truncate">
                    Chương {d.number}: {d.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{d.seriesTitle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {broken.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/[.04] p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-red-400">
            <CircleAlert size={18} /> Video cần xem lại
          </h2>
          <ul className="divide-y divide-border/70">
            {broken.map((b) => (
              <li key={b.id}>
                <Link href={`/videos/${b.id}`} className="block py-2.5 text-sm hover:text-white">
                  <span className="flex justify-between gap-4">
                    <span>
                      {b.seriesTitle} · chương {b.chapterNo}
                    </span>
                    <span className="shrink-0 text-xs text-red-400">{b.status === "failed" ? "Render lỗi" : "Upload lỗi"}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">{(b.status === "failed" ? b.error : b.uploadError) ?? ""}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

async function Covers() {
  await connection();
  const list = await seriesCards();
  if (!list.length)
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="mb-4 text-muted">Chưa có truyện nào. Viết một ý tưởng, AI dựng story bible cho bạn.</p>
        <Link href="/series/new" className="btn-primary">
          Tạo truyện đầu tiên
        </Link>
      </div>
    );
  return (
    <ul className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {list.map((s) => (
        <li key={s.id}>
          <SeriesCover s={s} />
        </li>
      ))}
    </ul>
  );
}

async function RecentVideos() {
  await connection();
  const list = await videoCards({ limit: 8 });
  if (!list.length) return <p className="text-sm text-muted">Chưa có video. Duyệt một chương là video tự render.</p>;
  return (
    <ul className="grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
      {list.map((v) => (
        <li key={v.id}>
          <VideoTile v={v} />
        </li>
      ))}
    </ul>
  );
}

/** Lượt gọi AI trong ngày quota (reset ~14–15h giờ Việt Nam). */
async function UsageToday() {
  await connection();
  const rows = (await db().select().from(aiUsage).where(eq(aiUsage.day, quotaDay())).orderBy(desc(aiUsage.calls))).filter((r) => !r.model.startsWith("_"));
  return (
    <section className="space-y-4 border-t border-border pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">AI đã dùng hôm nay</h2>
        <Link href="/usage" className="text-sm text-muted hover:text-foreground">
          Xem hạn mức
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Chưa gọi AI lần nào trong ngày. Quota Gemini free reset khoảng 14–15h.</p>
      ) : (
        <ul className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const brand = brandOfModel(r.model);
            return (
              <li key={r.model} className="flex items-center justify-between gap-4 border-b border-border/60 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  {brand ? <BrandIcon id={brand} size={16} /> : <span className="h-4 w-4" />}
                  <span className="truncate">{r.model}</span>
                </span>
                <span className={r.limited ? "text-red-400" : "text-muted"}>
                  {r.calls} lượt{r.limited ? ", hết quota" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
