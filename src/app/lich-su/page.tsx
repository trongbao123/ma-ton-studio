import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { addHistoryTopicAction, writeHistoryScriptAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { HistoryTabs, historyTabOf, type HistoryTab } from "@/components/history-tabs";
import { db } from "@/db";
import { chapters, series, videos, type Chapter } from "@/db/schema";
import { HISTORY_GENRE, HISTORY_STATUS_LABEL, historyTopicStatus, wikiTitleOf, type HistoryTopicStatus } from "@/lib/story/history";

export const maxDuration = 60;

const STATUS_TONE: Record<HistoryTopicStatus, string> = {
  "chua-viet": "bg-zinc-500/15 text-zinc-400",
  "dang-viet": "bg-sky-500/15 text-sky-300",
  "cho-sua": "bg-red-500/15 text-red-400",
  "co-kich-ban": "bg-amber-500/15 text-amber-400",
  "co-video": "bg-emerald-500/15 text-emerald-400",
};

export default function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
      <HistoryDashboard searchParams={searchParams} />
    </Suspense>
  );
}

async function HistoryDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const tab = historyTabOf((await searchParams).tab);
  const [s] = await db().select().from(series).where(eq(series.genre, HISTORY_GENRE)).orderBy(asc(series.id)).limit(1);
  if (!s) return <NoHistorySeries />;
  const topics = await db().select().from(chapters).where(eq(chapters.seriesId, s.id)).orderBy(asc(chapters.number));
  const withVideo = topics.length
    ? new Set((await db().select({ chapterId: videos.chapterId }).from(videos).where(inArray(videos.chapterId, topics.map((t) => t.id)))).map((v) => v.chapterId))
    : new Set<number>();
  const rows = topics.map((t) => ({ topic: t, status: historyTopicStatus(t, withVideo.has(t.id)) }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold">{s.title}</h1>
          <p className="text-sm text-muted">Lịch sử Việt Nam và thế giới — tài liệu không hư cấu, kịch bản chỉ từ hồ sơ tư liệu.</p>
        </div>
        <ActionForm action={writeHistoryScriptAction.bind(null, s.id)} submitLabel="Viết kịch bản đề tài kế" pendingLabel="Đang gửi lệnh…" />
      </header>
      <StatusCounts rows={rows} />
      <HistoryTabs current={tab} />
      <TabBody tab={tab} seriesId={s.id} rows={rows} />
    </div>
  );
}

type TopicRow = { topic: Chapter; status: HistoryTopicStatus };

function StatusCounts({ rows }: { rows: TopicRow[] }) {
  const statuses = Object.keys(HISTORY_STATUS_LABEL) as HistoryTopicStatus[];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {statuses.map((st) => (
        <div key={st} className="card">
          <p className="text-2xl font-bold tabular-nums">{rows.filter((r) => r.status === st).length}</p>
          <p className="text-xs text-muted">{HISTORY_STATUS_LABEL[st]}</p>
        </div>
      ))}
    </div>
  );
}

function TabBody({ tab, seriesId, rows }: { tab: HistoryTab; seriesId: number; rows: TopicRow[] }) {
  if (tab === "reels") return <EmptyTab text="Reels (60–90 giây, dọc 9:16) tự cắt từ video dài và đăng 3 cái/ngày lên Page Sử Ký Kể Chuyện. Có sau khi dựng video đầu tiên." />;
  if (tab === "binh-luan") return <EmptyTab text="Bình luận trên Facebook đổ về đây qua webhook; AI trả lời dựa đúng hồ sơ tư liệu của video, bình luận nhạy cảm được giữ lại để bạn xử lý. Có khi Page có video." />;
  if (tab === "so-lieu") return <EmptyTab text="Lượt xem, tương tác của video và Reels trên YouTube + Facebook, so Reel nào ăn view. Có khi đã đăng video." />;
  return <TopicsTab seriesId={seriesId} rows={rows} />;
}

function EmptyTab({ text }: { text: string }) {
  return <p className="card text-sm text-muted">{text}</p>;
}

function TopicsTab({ seriesId, rows }: { seriesId: number; rows: TopicRow[] }) {
  return (
    <section className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map(({ topic, status }) => {
          const words = topic.content.trim() ? topic.content.trim().split(/\s+/).length : 0;
          return (
            <li key={topic.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="w-8 text-sm tabular-nums text-muted">#{topic.number}</span>
              <div className="min-w-0 flex-1">
                <Link href={`/chapters/${topic.id}`} className="block truncate font-medium hover:text-accent">
                  {topic.title}
                </Link>
                <p className="truncate text-xs text-muted">Wikipedia: {wikiTitleOf(topic.outline) ?? "—"}</p>
              </div>
              <span className="text-xs tabular-nums text-muted">{words ? `${words.toLocaleString("vi-VN")} từ` : ""}</span>
              <span className="text-xs tabular-nums text-muted">{topic.dossier ? `${topic.dossier.sources.length} nguồn` : ""}</span>
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{HISTORY_STATUS_LABEL[status]}</span>
            </li>
          );
        })}
      </ul>
      <div className="card space-y-2">
        <h2 className="font-semibold">Thêm đề tài</h2>
        <p className="text-xs text-muted">Tên bài Wikipedia tiếng Anh dùng để gom tư liệu (vd “Battle of Gaugamela”). Đề tài nhạy cảm chính trị sẽ bị từ chối.</p>
        <ActionForm action={addHistoryTopicAction.bind(null, seriesId)} submitLabel="Thêm" variant="secondary" className="flex flex-wrap items-center gap-2">
          <input name="title" placeholder="Tiêu đề tiếng Việt" className="field min-w-0 flex-1 basis-60" aria-label="Tiêu đề đề tài" />
          <input name="wiki" placeholder="Bài Wikipedia tiếng Anh" className="field min-w-0 flex-1 basis-48" aria-label="Tên bài Wikipedia tiếng Anh" />
        </ActionForm>
      </div>
    </section>
  );
}

function NoHistorySeries() {
  return (
    <div className="card space-y-2">
      <h1 className="text-xl font-bold">Chưa có kênh lịch sử</h1>
      <p className="text-sm text-muted">
        Tạo bộ Sử Ký Kể Chuyện: GitHub → Actions → <b>render</b> → Run workflow với <code>newhistory:lich-su</code>.
      </p>
    </div>
  );
}
