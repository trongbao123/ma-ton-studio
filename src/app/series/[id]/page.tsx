import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { planChaptersAction, updateSeriesAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import { WriteButton } from "@/components/write-button";
import { db } from "@/db";
import { series } from "@/db/schema";
import { parseId } from "@/lib/params";
import { listChapters } from "@/lib/story/service";

export const maxDuration = 300;

export default function SeriesPage({ params }: PageProps<"/series/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
      <SeriesDetail params={params} />
    </Suspense>
  );
}

async function SeriesDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = parseId((await params).id);
  const [s] = await db().select().from(series).where(eq(series.id, id));
  if (!s) notFound();
  const list = await listChapters(id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{s.title}</h1>
        <p className="text-muted">{s.genre}</p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-lg font-bold">Chương ({list.length})</h2>
          <ActionForm
            action={planChaptersAction.bind(null, id)}
            submitLabel="Lên dàn ý tiếp"
            pendingLabel="AI đang lên dàn ý…"
            className="flex items-center gap-2"
          >
            <input name="count" type="number" min={1} max={30} defaultValue={10} className="field w-20" aria-label="Số chương" />
          </ActionForm>
        </div>

        {list.length === 0 ? (
          <p className="card text-muted">Chưa có chương. Bấm “Lên dàn ý tiếp” để AI lên dàn ý 10 chương đầu.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {list.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-10 text-sm text-muted">#{c.number}</span>
                <Link href={`/chapters/${c.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                  {c.title}
                </Link>
                <StatusBadge status={c.status} />
                {c.status === "outline" && (
                  <WriteButton chapterId={c.id} label="Viết" />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold">Story bible</h2>
        <ActionForm action={updateSeriesAction.bind(null, id)} submitLabel="Lưu" className="card space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <div>
              <label className="label" htmlFor="title">
                Tên truyện
              </label>
              <input id="title" name="title" className="field" defaultValue={s.title} />
            </div>
            <div>
              <label className="label" htmlFor="targetWords">
                Từ / chương
              </label>
              <input id="targetWords" name="targetWords" type="number" className="field" defaultValue={s.targetWords} />
            </div>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="autopilot" defaultChecked={s.autopilot} /> Autopilot: mỗi sáng tự viết 1 chương
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="autoApprove" defaultChecked={s.autoApprove} /> Tự duyệt + render (không cần đọc)
            </label>
          </div>
          <Field name="premise" label="Cốt truyện" rows={4} value={s.premise} />
          <Field name="voiceStyle" label="Giọng đọc" rows={2} value={s.voiceStyle} />
          <Field name="style" label="Giọng văn" rows={2} value={s.style} />
          <Field name="bible" label="Nhân vật, cảnh giới, thế lực, bối cảnh" rows={18} value={s.bible} />
        </ActionForm>
      </section>
    </div>
  );
}

function Field({ name, label, rows, value }: { name: string; label: string; rows: number; value: string }) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <textarea id={name} name={name} rows={rows} className="field" defaultValue={value} />
    </div>
  );
}
