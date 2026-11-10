import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { scanTrendsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { loadTrends, type TrendVideo } from "@/lib/trends";

export const metadata: Metadata = { title: "Xu hướng · Ma Tôn Studio" };

export default function TrendsPage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-2">
        <h1 className="font-serif text-3xl font-extrabold sm:text-4xl">Xu hướng</h1>
        <p className="text-sm text-muted">
          AI quét YouTube ngách truyện audio tu tiên / tiên hiệp / huyền huyễn ở Việt Nam (vidIQ, 30 ngày gần nhất). Kết quả tự đưa vào dàn ý chương và tiêu đề / thumbnail trong 7 ngày.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted">Đang tải…</p>}>
        <Report />
      </Suspense>
    </div>
  );
}

const vnTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const num = (n: number | null) => (n == null ? "—" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(Math.round(n)));

async function Report() {
  await connection();
  const data = await loadTrends();
  const i = data?.insights;
  return (
    <>
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm text-muted">
          {data ? `Quét lần cuối: ${vnTime(data.scannedAt)}` : "Chưa quét lần nào."} Tự quét tối đa 1 lần/ngày, mỗi lần ~45 credit vidIQ.
        </p>
        <ActionForm action={scanTrendsAction} submitLabel="Quét lại" pendingLabel="Đang gửi…" variant="secondary" />
      </section>
      {data && !i && <p className="text-sm text-muted">Đã có dữ liệu thô nhưng AI chưa tóm tắt được — quét lại để thử lần nữa.</p>}
      {i && (
        <>
          <Block title="Tóm tắt">
            <p className="max-w-3xl text-sm leading-relaxed">{i.summary}</p>
          </Block>
          <Block title="Việc nên làm cho kênh">
            <List items={i.actions} ordered />
          </Block>
          <Block title="Chủ đề nóng">
            <ul className="grid gap-3 sm:grid-cols-2">
              {i.hotTopics.map((t) => (
                <li key={t.topic} className="space-y-1 rounded-xl border border-border bg-card p-4 text-sm">
                  <b>{t.topic}</b>
                  <p className="text-muted">{t.why}</p>
                  <p className="text-xs text-muted/80">{t.evidence}</p>
                </li>
              ))}
            </ul>
          </Block>
          <div className="grid gap-10 lg:grid-cols-2">
            <Block title="Mẫu tiêu đề">
              <List items={i.titlePatterns} />
            </Block>
            <Block title="Mẫu thumbnail">
              <List items={i.thumbnailPatterns} />
            </Block>
            <Block title="Hook mở truyện">
              <List items={i.hooks} />
            </Block>
            <Block title="Khán giả muốn gì">
              <List items={i.audienceWants} />
            </Block>
          </div>
          <Block title="Từ khóa đang lên">
            <ul className="flex flex-wrap gap-2">
              {i.risingKeywords.map((k) => (
                <li key={k.keyword} title={k.note} className="rounded-full border border-border bg-card px-3 py-1 text-sm">
                  {k.keyword}
                  {k.note && <span className="ml-2 text-xs text-muted">{k.note}</span>}
                </li>
              ))}
            </ul>
          </Block>
        </>
      )}
      {data && (
        <>
          <Block title="Video trending">
            <Videos list={data.raw.trending} />
          </Block>
          <Block title="Video outlier (view vượt xa kênh)">
            <Videos list={data.raw.outliers} />
          </Block>
        </>
      )}
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">Chưa có.</p>;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`space-y-2 pl-5 text-sm ${ordered ? "list-decimal" : "list-disc"}`}>
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </Tag>
  );
}

function Videos({ list }: { list: TrendVideo[] }) {
  if (!list.length) return <p className="text-sm text-muted">Chưa có dữ liệu.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {list.map((v) => (
        <li key={v.url ?? v.title} className="flex items-center gap-4 p-3">
          {v.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh ngoài từ YouTube, không cần tối ưu bằng next/image
            <img src={v.thumbnail} alt="" loading="lazy" className="aspect-video w-28 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="aspect-video w-28 shrink-0 rounded-md bg-white/[.04]" />
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            {v.url ? (
              <a href={v.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sm font-medium hover:underline">
                {v.title}
              </a>
            ) : (
              <span className="line-clamp-2 text-sm font-medium">{v.title}</span>
            )}
            <p className="truncate text-xs text-muted">
              {v.channel ?? "—"}
              {v.publishedAt ? ` · ${v.publishedAt.slice(0, 10)}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs text-muted">
            <b className="block text-sm text-foreground">{num(v.views)} view</b>
            {v.vph != null && <span className="block">{num(v.vph)}/giờ</span>}
            {v.outlierScore != null && <span className="block">outlier {v.outlierScore}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
