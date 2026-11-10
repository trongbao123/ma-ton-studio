import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ChevronDown, ImageIcon } from "lucide-react";
import { BrandIcon } from "@/components/brand-icons";
import { Lamp } from "@/components/usage-lamp";
import { LAMP_TEXT, lampOf, nextReset, SOURCES, untilText, type Source, type SourceDay, type SourceId } from "@/lib/ai/sources";
import { configuredSources, lastQuotaDays, recentAiWork, usageByDay } from "@/lib/usage-data";

export const metadata: Metadata = { title: "Hạn mức AI · Ma Tôn Studio" };

export default function UsagePage() {
  return (
    <div className="space-y-12">
      <header className="max-w-2xl space-y-2">
        <h1 className="font-serif text-3xl font-extrabold sm:text-4xl">Hạn mức AI</h1>
        <p className="text-sm text-muted">Hôm nay mỗi AI đã làm bao nhiêu, còn lượt không, khi nào được làm mới — và AI nào đã làm video nào.</p>
      </header>
      <Suspense fallback={<p className="text-sm text-muted">Đang tải…</p>}>
        <Ledger />
      </Suspense>
      <Suspense fallback={null}>
        <Work />
      </Suspense>
    </div>
  );
}

const vnTime = (d: Date) => d.toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });
const dayLabel = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
const unit = (s: Source) => (["cloudflare", "deepinfra", "image-paid"].includes(s.id) ? "ảnh" : s.id === "voice" ? "đoạn" : "lượt");
const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

function SourceMark({ s }: { s: Source }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[.04]">
      {s.brand ? <BrandIcon id={s.brand} size={18} /> : <ImageIcon size={17} className="text-sky-300" />}
    </span>
  );
}

async function Ledger() {
  await connection();
  const days = lastQuotaDays(7);
  const [usage, configured] = await Promise.all([usageByDay(days), configuredSources()]);
  const today = usage[days[0]];
  const now = new Date();
  // Nguồn chính luôn hiện; nguồn dự phòng trả phí chỉ hiện khi có key hoặc đã dùng trong 7 ngày.
  const core: SourceId[] = ["claude-plan", "chatgpt-plan", "gemini-free", "voice", "cloudflare", "deepinfra"];
  const shown = SOURCES.filter((s) => core.includes(s.id) || configured[s.id] || days.some((d) => usage[d][s.id]?.calls));

  return (
    <>
      <section aria-labelledby="today" className="space-y-4">
        <h2 id="today" className="text-lg font-semibold">
          Hôm nay
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((s) => (
            <SourceRow key={s.id} s={s} day={today[s.id]} configured={Boolean(configured[s.id])} now={now} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="week" className="space-y-4">
        <h2 id="week" className="text-lg font-semibold">
          7 ngày qua
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="px-4 py-3 font-medium">Nguồn</th>
                {days.map((d, i) => (
                  <th key={d} className={`px-3 py-3 text-right font-medium tabular-nums ${i === 0 ? "text-foreground" : ""}`}>
                    {i === 0 ? "Hôm nay" : dayLabel(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {shown.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap px-4 py-2.5">{s.name}</td>
                  {days.map((d) => {
                    const c = usage[d][s.id];
                    return (
                      <td
                        key={d}
                        title={c?.limited ? "Hết lượt hẳn ngày này" : c?.partial ? "Có model hết lượt, chạy bằng dự phòng" : undefined}
                        className={`px-3 py-2.5 text-right tabular-nums ${c?.limited ? "font-semibold text-seal" : c?.partial ? "text-gold" : c?.calls ? "" : "text-muted/40"}`}
                      >
                        {c?.calls ?? "·"}
                        {(c?.limited || c?.partial) && <span className={`ml-1 inline-block h-1.5 w-1.5 -translate-y-0.5 rounded-full ${c.limited ? "bg-seal" : "bg-gold"}`} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">Ngày tính theo giờ Mỹ như Google (sang ngày mới lúc 15:00 giờ Việt Nam). Số vàng: có model hết lượt, app chạy bằng model dự phòng. Số đỏ: hết lượt hẳn.</p>
      </section>
    </>
  );
}

function SourceRow({ s, day, configured, now }: { s: Source; day?: SourceDay; configured: boolean; now: Date }) {
  const lamp = lampOf(day, configured);
  const reset = nextReset(s.id, now);
  const calls = day?.calls ?? 0;
  return (
    <li>
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-4 hover:bg-white/[.02] sm:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_7rem_auto] sm:px-5 [&::-webkit-details-marker]:hidden">
          <SourceMark s={s} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{s.name}</span>
            <span className="block truncate text-xs text-muted">{s.job}</span>
          </span>
          <span className="col-span-3 col-start-2 row-start-2 flex items-center gap-2 text-xs sm:col-span-1 sm:col-start-auto sm:row-start-auto">
            <Lamp lamp={lamp} />
            <span className={lamp === "limited" ? "text-seal" : lamp === "partial" ? "text-gold" : lamp === "active" ? "text-jade" : "text-muted"}>{LAMP_TEXT[lamp]}</span>
          </span>
          <span className="text-right">
            <span className="block text-xl font-semibold tabular-nums leading-none">{calls}</span>
            <span className="text-[11px] text-muted">
              {unit(s)}
              {s.unitUsd && calls ? ` · ≈ ${usd(calls * s.unitUsd)}` : ""}
            </span>
          </span>
          <ChevronDown size={16} className="hidden text-muted transition group-open:rotate-180 sm:block" />
        </summary>
        <div className="space-y-3 border-t border-border/60 bg-black/10 px-5 py-4 text-sm sm:pl-[4.25rem]">
          <p className="text-muted">
            {reset
              ? `${lamp === "limited" ? "Mở lại" : "Làm mới"} lúc ${vnTime(reset)} — ${untilText(reset, now)}.`
              : `${s.reset}.`}
            {s.billing === "plan" && " Hạn mức dùng chung với lúc bạn tự chat."}
            {s.billing === "paid" && s.unitUsd && ` Giá khoảng ${usd(s.unitUsd)} mỗi ${unit(s)}.`}
          </p>
          {day?.models.length ? (
            <ul className="space-y-1.5">
              {day.models.map((m) => (
                <li key={m.model} className="flex items-baseline justify-between gap-4">
                  <span className="truncate font-mono text-xs text-zinc-300">{m.model}</span>
                  <span className={`shrink-0 tabular-nums ${m.limited ? "text-seal" : ""}`}>
                    {m.calls} {m.limited && "· hết lượt"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{configured ? "Chưa có lượt nào hôm nay." : "Chưa kết nối — vào Cài đặt AI để thêm."}</p>
          )}
        </div>
      </details>
    </li>
  );
}

const STATUS: Record<string, string> = { queued: "Chờ render", rendering: "Đang render", ready: "Chờ đăng", published: "Đã đăng", failed: "Lỗi" };
const short = (m: string | null) => (m ? m.replace(/ \(gói\)$/, " · gói") : "—");

async function Work() {
  await connection();
  const list = await recentAiWork(8);
  if (!list.length) return null;
  return (
    <section aria-labelledby="work" className="space-y-4">
      <h2 id="work" className="text-lg font-semibold">
        AI nào làm video nào
      </h2>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">Video</th>
              <th className="px-4 py-3 font-medium">Viết tiêu đề, mô tả</th>
              <th className="px-4 py-3 font-medium">Vẽ ảnh</th>
              <th className="px-4 py-3 text-right font-medium">Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {list.map((v) => (
              <tr key={v.id}>
                <td className="px-4 py-2.5">
                  <Link href={`/videos/${v.id}`} className="hover:text-gold hover:underline">
                    Chương {v.number}
                  </Link>
                  <span className="block truncate text-xs text-muted">{v.seriesTitle}</span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">{short(v.agent)}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-zinc-300">{short(v.images)}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted">{STATUS[v.status] ?? v.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Video render trước khi có ghi nhận sẽ hiện “—”.</p>
    </section>
  );
}
