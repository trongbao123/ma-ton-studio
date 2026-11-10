import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SeriesCover } from "@/components/studio-cards";
import { cachedSeriesCards } from "@/lib/cached";

export default function SeriesListPage() {
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-3xl font-extrabold sm:text-4xl">Truyện</h1>
        <Link href="/series/new" className="btn-primary flex items-center gap-2">
          <Plus size={16} strokeWidth={2.2} /> Truyện mới
        </Link>
      </header>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const list = await cachedSeriesCards();
  if (!list.length) return <p className="text-muted">Chưa có truyện nào.</p>;
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
