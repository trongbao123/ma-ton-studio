import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { saveChapterAction, setApprovedAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { StatusBadge } from "@/components/status-badge";
import { WriteButton } from "@/components/write-button";
import { manualPrompt } from "@/lib/story/service";
import { db } from "@/db";
import { chapters, series } from "@/db/schema";
import { parseId } from "@/lib/params";

export const maxDuration = 300;

export default function ChapterPage({ params }: PageProps<"/chapters/[id]">) {
  return (
    <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
      <ChapterDetail params={params} />
    </Suspense>
  );
}

async function ChapterDetail({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = parseId((await params).id);
  const [c] = await db().select().from(chapters).where(eq(chapters.id, id));
  if (!c) notFound();
  const [[s], [prev], [next]] = await Promise.all([
    db().select({ id: series.id, title: series.title }).from(series).where(eq(series.id, c.seriesId)),
    neighbour(c.seriesId, c.number - 1),
    neighbour(c.seriesId, c.number + 1),
  ]);
  const words = c.content.trim() ? c.content.trim().split(/\s+/).length : 0;
  const approved = c.status === "approved";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href={`/series/${s.id}`} className="text-sm text-muted hover:text-accent">
            ← {s.title}
          </Link>
          <h1 className="text-2xl font-bold">
            Chương {c.number}: {c.title}
          </h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-muted">
            <StatusBadge status={c.status} /> {words.toLocaleString("vi-VN")} từ
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!approved && (
            <>
              <WriteButton chapterId={c.id} label={c.content ? "AI viết lại" : "AI viết chương"} />
              <CopyButton text={await manualPrompt(c)} label="Copy prompt (dán vào ChatGPT)" />
            </>
          )}
          {c.content && (
            <ActionForm action={setApprovedAction.bind(null, c.id, !approved)} submitLabel={approved ? "Bỏ duyệt" : "Duyệt"} />
          )}
        </div>
      </div>

      {approved ? (
        <article className="card whitespace-pre-wrap font-serif text-base leading-relaxed">{c.content}</article>
      ) : (
        <>
        {/* key theo updatedAt để form nạp lại nội dung mới sau khi AI viết xong */}
        <ActionForm
          key={c.updatedAt.toISOString()}
          action={saveChapterAction.bind(null, c.id)}
          submitLabel="Lưu chỉnh sửa"
          variant="secondary"
          className="space-y-4"
        >
          <div>
            <label className="label" htmlFor="title">
              Tiêu đề
            </label>
            <input id="title" name="title" className="field" defaultValue={c.title} />
          </div>
          <div>
            <label className="label" htmlFor="outline">
              Dàn ý
            </label>
            <textarea id="outline" name="outline" rows={6} className="field" defaultValue={c.outline} />
          </div>
          <div>
            <label className="label" htmlFor="content">
              Nội dung
            </label>
            <textarea
              id="content"
              name="content"
              rows={30}
              className="field font-serif text-base leading-relaxed"
              defaultValue={c.content}
              placeholder="Chưa viết — bấm “AI viết chương”."
             
            />
          </div>
          {c.summary && (
            <p className="card text-sm text-muted">
              <span className="font-medium text-foreground">Tóm tắt (AI dùng làm trí nhớ): </span>
              {c.summary}
            </p>
          )}
        </ActionForm>
        </>
      )}

      <div className="flex justify-between text-sm">
        {prev ? <Link href={`/chapters/${prev.id}`}>← Chương {prev.number}</Link> : <span />}
        {next ? <Link href={`/chapters/${next.id}`}>Chương {next.number} →</Link> : <span />}
      </div>
    </div>
  );
}

function neighbour(seriesId: number, number: number) {
  return db()
    .select({ id: chapters.id, number: chapters.number })
    .from(chapters)
    .where(and(eq(chapters.seriesId, seriesId), eq(chapters.number, number)));
}
