import { count, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { db } from "@/db";
import { chapters, series } from "@/db/schema";

export default function HomePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Truyện của kênh</h1>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <SeriesList />
      </Suspense>
    </div>
  );
}

async function SeriesList() {
  await connection();
  const rows = await db()
    .select({
      id: series.id,
      title: series.title,
      genre: series.genre,
      total: count(chapters.id),
      pending: sql<number>`count(*) filter (where ${chapters.status} = 'draft')`.mapWith(Number),
      approved: sql<number>`count(*) filter (where ${chapters.status} = 'approved')`.mapWith(Number),
    })
    .from(series)
    .leftJoin(chapters, eq(chapters.seriesId, series.id))
    .groupBy(series.id)
    .orderBy(desc(series.createdAt));

  if (rows.length === 0) {
    return (
      <div className="card text-center">
        <p className="mb-4 text-muted">Chưa có truyện nào.</p>
        <Link href="/series/new" className="btn-primary">
          Tạo truyện đầu tiên
        </Link>
      </div>
    );
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/series/${r.id}`} className="card block hover:border-accent">
            <p className="text-lg font-bold">{r.title}</p>
            <p className="mb-3 text-sm text-muted">{r.genre}</p>
            <p className="text-sm">
              {r.total} chương · <span className="text-amber-500">{r.pending} chờ duyệt</span> ·{" "}
              <span className="text-emerald-500">{r.approved} đã duyệt</span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
