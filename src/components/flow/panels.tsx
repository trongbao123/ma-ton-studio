"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronDown, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { disconnectYoutubeAction, markPublishedAction, optimizeSeoAction, retryPublishAction, setTaskAiAction, updateFlowSettingsAction } from "@/app/actions";
import { BrandIcon } from "@/components/brand-icons";
import { YtStats } from "@/components/yt-stats";
import { DEFAULT_MODEL, PROVIDERS, type ProviderId, type Route } from "@/lib/ai/routing";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { formatSlot, formatTime, type CardId, type FlowData, type NodeId } from "@/lib/flow/model";
import type { Scene } from "@/lib/flow/progress";
import { musicTitle, thousands } from "@/lib/flow/derive";
import { scoreMeta, SEO_TARGET, totalScore, type SeoScore } from "@/lib/flow/seo";
import { VOICES } from "@/lib/flow/voices";

export type Tab = "out" | "in" | "log";
type PanelProps = { data: FlowData; tab: Tab };

const PENDING = "Chưa có dữ liệu — video này render trước khi có ghi tiến độ, render lại để xem.";

export function Empty({ text = PENDING }: { text?: string }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted">{text}</p>;
}

/** Bản gộp dùng lại chương/giọng/ảnh của các video chương — chỉ rõ dùng lại từ đâu thay vì để trống. */
function ReuseNote({ data }: { data: FlowData }) {
  const c = data.video.meta?.compilation;
  if (!c) return null;
  return (
    <div className="mb-5 rounded-xl border border-sky-500/30 bg-sky-950/30 px-4 py-3 text-xs text-sky-100">
      <p className="font-medium">
        Dùng lại từ chương {c.from}–{c.to}
      </p>
      <p className="mt-1 text-sky-200/80">Bản gộp không viết/đọc/vẽ lại — lấy nội dung từ các video chương đã render:</p>
      <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {c.videoIds.map((id) => (
          <a key={id} href={`/videos/${id}`} className="text-sky-300 underline">
            Video #{id}
          </a>
        ))}
      </p>
    </div>
  );
}

function Sec({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-7 last:mb-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

const tone = (n: number) => (n >= 80 ? "text-emerald-400" : n >= 50 ? "text-amber-400" : "text-rose-400");

/** Một mục có điểm SEO kiểu vidIQ: số màu ở góc phải, bấm để xem checklist chấm điểm. */
function ScoredSec({ title, seo, children }: { title: string; seo: SeoScore; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sec
      title={title}
      right={
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={seo.source === "vidiq" ? "Điểm vidIQ — bấm xem chi tiết" : "Điểm SEO — bấm xem chi tiết"}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-white/5"
        >
          <span className="text-[10px] uppercase tracking-wider text-muted">{seo.source === "vidiq" ? "vidIQ" : "SEO"}</span>
          <span className={`text-base font-semibold tabular-nums ${tone(seo.score)}`}>{seo.score}</span>
          <ChevronDown size={12} className={`text-muted transition ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {children}
      {open && (
        <ul className="mt-2 space-y-1 rounded-xl border border-border bg-card/60 px-3 py-2.5 text-xs">
          {seo.checks.map((c) => (
            <li key={c.text} className="flex items-start gap-2">
              <span className={c.ok ? "text-emerald-400" : c.points > 0 ? "text-amber-400" : "text-rose-400"}>{c.ok ? "✓" : c.points > 0 ? "◐" : "✕"}</span>
              <span className="min-w-0 flex-1 text-zinc-300">{c.text}</span>
              <span className="shrink-0 tabular-nums text-muted">
                {c.points}/{c.max}
              </span>
            </li>
          ))}
          {seo.source === "vidiq" && <li className="pt-1 text-muted">Số to là điểm vidIQ; checklist trên là app tự kiểm.</li>}
        </ul>
      )}
    </Sec>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border/60 py-2.5 text-[13px]">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="min-w-0 break-words text-right">{v}</span>
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <div className="whitespace-pre-wrap break-words rounded-xl border border-border bg-[#0e0e12] px-4 py-3 text-[13px] leading-relaxed text-zinc-300">
    {children}
  </div>
);

function More({ text, limit = 280 }: { text: string; limit?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= limit) return <Code>{text}</Code>;
  return (
    <Code>
      {open ? text : `${text.slice(0, limit)}…`}{" "}
      <button type="button" onClick={() => setOpen(!open)} className="text-sky-400 hover:underline">
        {open ? "thu gọn" : "xem thêm"}
      </button>
    </Code>
  );
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Công tắc bật/tắt. */
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-xs">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${on ? "bg-emerald-500" : "bg-zinc-600"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

/** Lưu cài đặt bộ truyện ngay khi đổi; giữ giá trị cục bộ để công tắc phản hồi tức thì. */
function useSetting<T extends string | boolean>(seriesId: number, key: "ttsVoice" | "makeShort" | "autoPublish", initial: T) {
  const [value, setValue] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = (v: T) => {
    setValue(v);
    start(async () => {
      const r = await updateFlowSettingsAction(seriesId, { [key]: v });
      setMsg(r.error ?? r.ok ?? null);
    });
  };
  return { value, save, note: pending ? "Đang lưu…" : msg };
}

function StepLog({ data, id, extra }: { data: FlowData; id: NodeId; extra?: ReactNode }) {
  const p = data.video.progress?.steps[id];
  if (!p && !extra) return <Empty />;
  return (
    <>
      {extra}
      {p && (
        <div>
          {p.startedAt && <Row k="Bắt đầu" v={formatTime(p.startedAt)} />}
          {p.finishedAt && <Row k="Kết thúc" v={formatTime(p.finishedAt)} />}
          {p.error && (
            <div className="mt-2">
              <Code>{p.error}</Code>
            </div>
          )}
          <ul className="mt-3 space-y-1 font-mono text-[11px]">
            {[...p.log].reverse().map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted">{formatTime(l.at).slice(0, 5)}</span>
                <span className={l.text.startsWith("⚠") || l.text.startsWith("Lỗi") ? "text-amber-300" : "text-zinc-300"}>{l.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Trends({ data, tab }: PanelProps) {
  const t = data.trends;
  if (tab === "log") return <Empty text="Quét xu hướng chạy riêng (GitHub Actions) — xem ở trang Xu hướng." />;
  if (tab === "in")
    return (
      <Sec title="Nguồn">
        <p className="text-xs leading-relaxed text-zinc-300">
          vidIQ lấy video trending và outlier của ngách (VN, 30 ngày); GPT tóm tắt thành chủ đề nóng, mẫu tiêu đề, móc câu. Kết quả còn hạn 7 ngày được đưa vào dàn ý chương và SEO.
        </p>
        <Link href="/trends" className="mt-3 inline-block text-xs text-sky-400 hover:underline">
          Mở trang Xu hướng →
        </Link>
      </Sec>
    );
  if (!t) return <Empty text="Chưa quét xu hướng — vào trang Xu hướng bấm quét." />;
  return (
    <>
      <Sec title="Lần quét">
        <Row k="Thời điểm" v={formatTime(t.scannedAt)} />
        <Row k="Trạng thái" v={t.fresh ? <span className="text-emerald-400">còn hạn</span> : <span className="text-amber-400">quá 7 ngày</span>} />
      </Sec>
      {t.summary && (
        <Sec title="Tóm tắt">
          <More text={t.summary} />
        </Sec>
      )}
      <Sec title="Chủ đề nóng">
        {t.hotTopics.length ? (
          <ol className="space-y-2 text-xs">
            {t.hotTopics.map((h, i) => (
              <li key={h.topic}>
                <b className="text-zinc-100">
                  #{i + 1} {h.topic}
                </b>
                <span className="block text-muted">{h.why}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty text="Chưa có chủ đề nóng." />
        )}
      </Sec>
      {t.titlePatterns.length > 0 && (
        <Sec title="Mẫu tiêu đề đang ăn view">
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-300">
            {t.titlePatterns.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Sec>
      )}
      {t.risingKeywords.length > 0 && (
        <Sec title="Từ khóa đang lên">
          <div className="flex flex-wrap gap-1.5">
            {t.risingKeywords.map((k) => (
              <span key={k.keyword} title={k.note} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px]">
                {k.keyword}
              </span>
            ))}
          </div>
        </Sec>
      )}
    </>
  );
}

function Chapter({ data, tab }: PanelProps) {
  const c = data.chapter;
  if (tab === "in")
    return (
      <>
        <ReuseNote data={data} />
        <Sec title="Dàn ý chương">{c.outline ? <More text={c.outline} limit={1200} /> : <Empty text="Chương không có dàn ý." />}</Sec>
        <Sec title="Memory · Story bible">
          <More text={data.series.bibleExcerpt || "—"} />
        </Sec>
        <Sec title="Tóm tắt chương trước">
          <More text={data.prevSummary ?? "Chương đầu — chưa có tóm tắt."} />
        </Sec>
      </>
    );
  if (tab === "log") return <Empty text="Bước này không có nhật ký riêng." />;
  return (
    <>
      <ReuseNote data={data} />
      <Sec
        title="Chat model"
        right={
          <Link href="/settings/ai" className="text-[11px] text-muted hover:text-sky-400">
            Cài đặt đầy đủ
          </Link>
        }
      >
        <AiPicker data={data} task="story" label="Viết chương" />
        <p className="mt-2 text-[11px] text-muted">Theo cấu hình hiện tại; chương này có thể do AI kế tiếp viết nếu AI đầu hết lượt. Đổi áp dụng từ lần viết sau.</p>
      </Sec>
      <Sec title={`Chương ${c.number}`}>
        <Row k="Tiêu đề" v={c.title} />
        <Row k="Độ dài" v={`${thousands(c.words)} từ`} />
        <Row k="Duyệt lúc" v={formatTime(c.approvedAt)} />
      </Sec>
      <Sec
        title="Nội dung chương"
        right={
          <Link href={`/chapters/${c.id}`} className="text-[11px] text-sky-400 hover:underline">
            Sửa chương →
          </Link>
        }
      >
        {c.content ? (
          <article className="whitespace-pre-wrap rounded-xl border border-border bg-[#0e0e12] px-4 py-3 font-serif text-[14px] leading-7 text-zinc-200">
            {c.content}
          </article>
        ) : (
          <Empty text="Chương chưa có nội dung." />
        )}
      </Sec>
    </>
  );
}

function Seo({ data, tab }: PanelProps) {
  const m = data.video.meta;
  const prompts = data.video.progress?.prompts;
  if (tab === "in")
    return (
      <>
        <Sec title="vidIQ · từ khóa người xem tìm thật">
          {m?.seo?.keywords?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {m.seo.keywords.map((k) => (
                <span key={k} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px]">
                  {k}
                </span>
              ))}
            </div>
          ) : (
            <Empty text="Chưa có từ khóa vidIQ cho video này." />
          )}
        </Sec>
        <Sec title="Prompt tiêu đề / mô tả">{prompts?.meta ? <More text={prompts.meta} /> : <Empty />}</Sec>
        <Sec title="Prompt chia cảnh">{prompts?.scenes ? <More text={prompts.scenes} /> : <Empty />}</Sec>
      </>
    );
  if (tab === "log") return <StepLog data={data} id="agent" />;
  const model = data.video.progress?.steps.agent?.model;
  const score = m ? scoreMeta(m, data.series.title) : null;
  return (
    <>
      <Sec
        title="Chat model"
        right={
          <Link href="/settings/ai" className="text-[11px] text-muted hover:text-sky-400">
            Cài đặt đầy đủ
          </Link>
        }
      >
        <div className="space-y-2.5">
          <AiPicker data={data} task="meta" label="Tiêu đề / mô tả" />
          <AiPicker data={data} task="scenes" label="Prompt ảnh" />
          <p className="text-[11px] text-muted">
            Lần render này dùng: <span className="text-zinc-300">{model ?? "chưa ghi (video cũ)"}</span>. Đổi AI áp dụng từ lần render sau; AI đầu lỗi hoặc hết lượt thì tự
            sang AI kế tiếp.
          </p>
        </div>
      </Sec>
      {!m || !score ? (
        <Empty text="Chưa có SEO & thumbnail cho video này." />
      ) : (
        <>
          {data.video.files["thumbnail.jpg"] && (
            <Sec title="Thumbnail">
              {/* eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect */}
              <img src={data.video.files["thumbnail.jpg"]} alt="Thumbnail" className="aspect-video w-full rounded-xl border border-border object-cover" />
            </Sec>
          )}
          <SeoSummary score={score} videoId={data.video.id} />
          <ScoredSec title="Tiêu đề YouTube" seo={score.title}>
            <Code>{m.title}</Code>
          </ScoredSec>
          {m.seo?.titleOptions && m.seo.titleOptions.length > 1 && (
            <Sec title="Các phương án tiêu đề (vidIQ chấm)">
              <ul className="space-y-1.5">
                {[...m.seo.titleOptions]
                  .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
                  .map((o) => (
                    <li key={o.title} className="flex items-start justify-between gap-3 text-xs">
                      <span className={o.title === m.title ? "text-zinc-100" : "text-muted"}>{o.title}</span>
                      <span className={`shrink-0 font-semibold tabular-nums ${o.score == null ? "text-muted" : tone(o.score)}`}>{o.score ?? "?"}</span>
                    </li>
                  ))}
              </ul>
            </Sec>
          )}
          <ScoredSec title="Mô tả" seo={score.description}>
            <More text={m.description} />
          </ScoredSec>
          <ScoredSec title="Tag" seo={score.tags}>
            <div className="flex flex-wrap gap-1.5">
              {m.tags.map((t) => (
                <span key={t} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px]">
                  {t}
                </span>
              ))}
            </div>
          </ScoredSec>
          <ScoredSec title="Short" seo={score.short}>
            <Code>{m.shortTitle}</Code>
          </ScoredSec>
        </>
      )}
    </>
  );
}

const info = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;
const routeId = (r: Route) => `${r.provider}|${r.model}`;
const routeLabel = (r: Route) => (r.model ? r.model : DEFAULT_MODEL[r.provider] ? DEFAULT_MODEL[r.provider] : "model mặc định");

/** Chọn AI chạy một việc ngay trong bảng — lưu luôn, không chuyển trang. */
function AiPicker({ data, task, label }: { data: FlowData; task: "story" | "meta" | "scenes"; label: string }) {
  const chain = data.ai.text?.[task] ?? [];
  const have = data.ai.available ?? [];
  const current = chain.find((r) => have.includes(r.provider)) ?? chain[0];
  const [value, setValue] = useState(current ? routeId(current) : "");
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const options: Route[] = PROVIDERS.flatMap((p) => [
    ...(DEFAULT_MODEL[p.id] ? [] : [{ provider: p.id, model: "" }]),
    ...p.models.map((model) => ({ provider: p.id, model })),
  ]);
  const picked = value ? (value.split("|") as [ProviderId, string]) : null;
  const save = (id: string) => {
    setValue(id);
    const [provider, model] = id.split("|") as [ProviderId, string];
    start(async () => setMsg(await setTaskAiAction(task, { provider, model })));
  };
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.04]">
          {picked && <BrandIcon id={info(picked[0]).brand} size={17} />}
        </span>
        <span className="w-24 shrink-0 text-xs text-muted">{label}</span>
        <select value={value} onChange={(e) => save(e.target.value)} disabled={pending} aria-label={`AI cho ${label}`} className="field min-w-0 flex-1 !py-1.5 text-xs">
          {PROVIDERS.map((p) => (
            <optgroup key={p.id} label={have.includes(p.id) ? p.label : `${p.label} — chưa có key`}>
              {options
                .filter((o) => o.provider === p.id)
                .map((o) => (
                  <option key={routeId(o)} value={routeId(o)} disabled={!have.includes(o.provider)}>
                    {routeLabel(o)}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>
      {(pending || msg) && (
        <p className={`mt-1 pl-[2.6rem] text-[11px] ${msg?.error ? "text-rose-400" : "text-emerald-400"}`}>{pending ? "Đang lưu…" : (msg?.error ?? msg?.ok)}</p>
      )}
    </div>
  );
}

/** Điểm SEO tổng (trung bình 4 mục) — như vòng điểm của vidIQ. */
function SeoSummary({ score, videoId }: { score: ReturnType<typeof scoreMeta>; videoId: number }) {
  const total = totalScore(score);
  const deg = Math.round((total / 100) * 360);
  const color = total >= 80 ? "#34d399" : total >= 50 ? "#fbbf24" : "#fb7185";
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const fill = () =>
    start(async () => {
      const r = await optimizeSeoAction(videoId);
      setMsg(r);
      router.refresh();
    });
  return (
    <div className="mb-7 rounded-xl border border-border bg-card/60 px-4 py-3">
      <div className="flex items-center gap-4">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, #27272a 0)` }}>
          <div className="grid h-11 w-11 place-items-center rounded-full bg-[#0e0e12]">
            <span className={`text-lg font-semibold tabular-nums ${tone(total)}`}>{total}</span>
          </div>
        </div>
        <div className="min-w-0 text-xs">
          <p className="font-medium text-zinc-200">Điểm SEO</p>
          <p className="mt-0.5 text-muted">
            {score.title.source === "vidiq" ? "Tiêu đề do vidIQ chấm, còn lại app tự chấm." : "App tự chấm theo checklist kiểu vidIQ."} Bấm số ở từng mục để xem chi tiết.
          </p>
        </div>
      </div>
      {total < SEO_TARGET && (
        <button
          type="button"
          onClick={fill}
          disabled={pending}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-sky-600 px-3 py-2 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-60"
        >
          <Wand2 size={14} />
          {pending ? "AI đang sửa tới khi đạt ≥ 90… (30–90 giây)" : `Magic fill — tự sửa lên ≥ ${SEO_TARGET} điểm`}
        </button>
      )}
      {msg && !pending && <p className={`mt-2 text-[11px] ${msg.error ? "text-rose-400" : "text-emerald-400"}`}>{msg.error ?? msg.ok}</p>}
    </div>
  );
}

function Tts({ data, tab }: PanelProps) {
  const voice = useSetting(data.series.id, "ttsVoice", data.series.ttsVoice);
  if (tab === "in") return <Empty text="Đầu vào là nội dung chương (Viết chương) và kịch bản Short (SEO & Thumbnail)." />;
  if (tab === "log") return <StepLog data={data} id="tts" />;
  const d = data.video.durationSec;
  const { files } = data.video;
  return (
    <>
      <ReuseNote data={data} />
      <Sec title="Nghe thử">
        {files["narration.m4a"] ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">Video dài</p>
            <audio src={files["narration.m4a"]} controls preload="none" className="w-full" />
            {files["short-narration.m4a"] && (
              <>
                <p className="text-xs text-muted">Short</p>
                <audio src={files["short-narration.m4a"]} controls preload="none" className="w-full" />
              </>
            )}
          </div>
        ) : (
          <Empty text="Chưa có file nghe thử — nghe trong video ở thẻ Dựng video." />
        )}
      </Sec>
      <Sec title="Giọng đọc" right={voice.note && <span className="text-[11px] text-emerald-400">{voice.note}</span>}>
        <VoicePicker value={voice.value} onChange={voice.save} />
        <p className="mt-2 text-[11px] text-muted">Áp dụng cho cả bộ truyện từ lần render sau.</p>
      </Sec>
      <Sec title="Thông tin">
        <Row k="Thời lượng" v={d ? `${Math.floor(d / 60)} phút ${d % 60} giây` : "—"} />
        <Row k="Chất giọng mong muốn" v={<span className="line-clamp-2">{data.series.voiceStyle}</span>} />
      </Sec>
    </>
  );
}

/** Chọn giọng: thẻ giọng đang dùng, bấm mở danh sách chia nam/nữ (thay ô chọn mặc định của trình duyệt). */
function VoicePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = VOICES.find((v) => v.id === value) ?? { id: value, note: "" };
  const groups = [
    { label: "Giọng nam", list: VOICES.filter((v) => !v.female) },
    { label: "Giọng nữ", list: VOICES.filter((v) => v.female) },
  ];
  return (
    <div className="rounded-xl border border-border bg-[#101118]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left hover:bg-white/[.03]"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-400/10 text-sky-300">
          <AudioLines size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-sm">{current.id}</b>
          <span className="block truncate text-xs text-muted">{current.note}</span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="max-h-80 space-y-4 overflow-y-auto border-t border-border p-3">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-2 px-1 text-xs font-medium text-muted">{g.label}</p>
              <ul className="grid grid-cols-2 gap-1.5">
                {g.list.map((v) => {
                  const on = v.id === value;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange(v.id);
                          setOpen(false);
                        }}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          on ? "border-sky-400/60 bg-sky-400/10" : "border-transparent hover:bg-white/[.04]"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-1">
                          <b className="truncate text-[13px]">{v.id}</b>
                          {on && <Check size={14} className="shrink-0 text-sky-300" />}
                        </span>
                        <span className="block truncate text-[11px] text-muted">{v.note}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Images({ data, tab }: PanelProps) {
  const [which, setWhich] = useState<"long" | "short">("long");
  const [zoom, setZoom] = useState<{ src: string; scene?: Scene } | null>(null);
  if (tab === "log") return <StepLog data={data} id="images" />;
  const scenes = data.video.progress?.scenes;
  const list = scenes?.[which] ?? [];
  const switcher = scenes?.short.length ? (
    <div className="flex rounded-lg border border-border p-0.5 text-[11px]">
      {(["long", "short"] as const).map((w) => (
        <button key={w} type="button" onClick={() => setWhich(w)} className={`rounded-md px-2 py-0.5 ${which === w ? "bg-card text-foreground" : "text-muted"}`}>
          {w === "long" ? "Dài" : "Short"}
        </button>
      ))}
    </div>
  ) : null;
  if (tab === "in")
    return list.length ? (
      <Sec title="Prompt từng cảnh" right={switcher}>
        <ol className="space-y-3">
          {list.map((sc) => (
            <li key={sc.i}>
              <p className="mb-1 text-[11px] text-muted">
                Cảnh {sc.i + 1} · {clock(sc.start)}
                {sc.action && " · hành động"}
              </p>
              <Code>{sc.prompt}</Code>
            </li>
          ))}
        </ol>
      </Sec>
    ) : (
      <Empty />
    );
  const thumb = data.video.files["thumbnail.jpg"];
  const ratio = which === "long" ? "aspect-video" : "aspect-[9/16]";
  const pick = data.ai.image;
  return (
    <>
      <ReuseNote data={data} />
      {!data.video.meta?.compilation && (
        <Sec
          title="AI vẽ ảnh"
          right={
            <Link href="/settings/ai" className="text-[11px] text-muted hover:text-sky-400">
              Cài đặt đầy đủ
            </Link>
          }
        >
          <Row k="Model" v={pick.model} />
          <p className="mt-2 text-[11px] text-muted">
            {pick.source === "tracked"
              ? "Model pipeline ghi lúc vẽ ảnh cho video này."
              : pick.source === "usage"
                ? "Pipeline chưa ghi model — suy từ AI vẽ được dùng nhiều nhất trong ngày render (bảng lượt dùng AI)."
                : "Chưa có dữ liệu thật — đây là AI đầu danh sách vẽ ảnh trong Cài đặt AI (Codex gói Plus được ưu tiên khi đã kết nối)."}
          </p>
        </Sec>
      )}
      <Sec title="Ảnh từng cảnh" right={switcher}>
        {list.length ? (
          <div className={`grid gap-1.5 ${which === "long" ? "grid-cols-3" : "grid-cols-5"}`}>
            {list.map((sc) => {
              const src = sc.file && data.video.files[sc.file];
              return src ? (
                <button key={sc.i} type="button" onClick={() => setZoom({ src, scene: sc })} className={`relative cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-white/10 ${ratio}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect, không tối ưu được bằng next/image */}
                  <img src={src} alt="" loading="lazy" className="h-full w-full animate-[fadein_.4s] object-cover" />
                  <span className="absolute bottom-0.5 left-1 text-[10px] font-bold text-white [text-shadow:0_1px_3px_#000]">
                    {sc.i + 1} · {clock(sc.start)}
                  </span>
                </button>
              ) : (
                <div
                  key={sc.i}
                  className={`flex items-end rounded-lg bg-[repeating-linear-gradient(45deg,#1a1a20_0_6px,#16161b_6px_12px)] p-1 text-[10px] text-zinc-600 ${ratio}`}
                >
                  {sc.i + 1}
                </div>
              );
            })}
          </div>
        ) : (
          <Empty />
        )}
      </Sec>
      <Sec title="Thumbnail">
        {thumb ? (
          <button type="button" onClick={() => setZoom({ src: thumb })} className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- như trên */}
            <img src={thumb} alt="Thumbnail" className="aspect-video w-full object-cover" />
          </button>
        ) : (
          <Empty text="Chưa có thumbnail." />
        )}
      </Sec>
      {zoom && <Lightbox src={zoom.src} scene={zoom.scene} onClose={() => setZoom(null)} />}
    </>
  );
}

function Lightbox({ src, scene, onClose }: { src: string; scene?: Scene; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal ra body: inspector có `translate` nên `fixed` bên trong bị giam trong khung inspector.
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-50 flex cursor-zoom-out flex-col items-center justify-center gap-3 bg-black/90 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- như trên */}
      <img src={src} alt="" className="max-h-[75vh] max-w-full rounded-lg object-contain" />
      {scene && (
        <div className="max-w-2xl space-y-1 text-center text-xs text-zinc-300">
          <p className="text-zinc-400">
            Cảnh {scene.i + 1} · {clock(scene.start)}–{clock(scene.end)}
          </p>
          <p className="line-clamp-3 italic">“{scene.text}”</p>
          <p className="line-clamp-2 font-mono text-[11px] text-zinc-500">{scene.prompt}</p>
        </div>
      )}
    </div>,
    document.body,
  );
}

function VideoOut({ data, tab }: PanelProps) {
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  // Next ẩn trang cũ bằng <Activity> thay vì gỡ — dừng video để không phát tiếng khi đã rời trang.
  useLayoutEffect(() => {
    const vids = refs.current;
    return () => vids.forEach((v) => v?.pause());
  }, []);
  const short = useSetting(data.series.id, "makeShort", data.series.makeShort);
  const { files, error, runUrl } = data.video;
  if (tab === "in") return <Empty text="Đầu vào là giọng đọc + ảnh cảnh ở các thẻ trước." />;
  if (tab === "log")
    return (
      <StepLog
        data={data}
        id="video"
        extra={
          (error || runUrl) && (
            <div className="mb-3 space-y-2">
              {data.video.status === "failed" && error && <Code>{error}</Code>}
              {runUrl && (
                <a href={runUrl} target="_blank" className="inline-block text-xs text-sky-400 underline">
                  Xem log render trên GitHub
                </a>
              )}
            </div>
          )
        }
      />
    );
  return (
    <>
      <Sec title="Video dài">
        {files["long.mp4"] ? (
          <video ref={(el) => void (refs.current[0] = el)} src={files["long.mp4"]} poster={files["thumbnail.jpg"]} controls preload="metadata" className="aspect-video w-full rounded-xl bg-black" />
        ) : (
          <Empty text="Chưa có video dài." />
        )}
      </Sec>
      <Sec title="Short">
        {files["short.mp4"] ? (
          <video ref={(el) => void (refs.current[1] = el)} src={files["short.mp4"]} controls preload="metadata" className="mx-auto aspect-[9/16] max-h-[420px] rounded-xl bg-black" />
        ) : (
          <Empty text="Video này không có Short." />
        )}
      </Sec>
      <Sec title="Nhạc nền">
        <Row k="Bài" v={(data.video.meta && musicTitle(data.video.meta.description)) || "Chưa có nhạc nền"} />
      </Sec>
      <Sec title="Cài đặt" right={short.note && <span className="text-[11px] text-emerald-400">{short.note}</span>}>
        <Toggle on={short.value} onChange={short.save} label="Làm Short (cả bộ truyện, từ lần render sau)" />
      </Sec>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["long.mp4", "⬇ Video dài"],
            ["short.mp4", "⬇ Short"],
            ["thumbnail.jpg", "⬇ Thumbnail"],
          ] as const
        ).map(([f, text]) =>
          files[f] ? (
            <a key={f} href={files[f]} className="btn-secondary !px-3 !py-1.5 text-xs">
              {text}
            </a>
          ) : null,
        )}
      </div>
    </>
  );
}

const UPLOAD_TEXT = { none: "chưa đăng", uploading: "đang upload…", scheduled: "đã lên lịch", failed: "lỗi" } as const;

function Youtube({ data, tab }: PanelProps) {
  const auto = useSetting(data.series.id, "autoPublish", data.series.autoPublish);
  if (tab === "in") return <Empty text="Đầu vào: video dài, Short, thumbnail và tiêu đề/mô tả/tag từ thẻ SEO & Thumbnail." />;
  if (tab === "log") return <StepLog data={data} id="youtube" />;
  const v = data.video;
  const m = v.meta;
  const thumb = v.files["thumbnail.jpg"];
  const hasShort = Boolean(v.files["short.mp4"]);
  const link = (id: string) => (
    <a href={`https://youtu.be/${id}`} target="_blank" className="text-sky-400 underline">
      youtu.be/{id}
    </a>
  );
  return (
    <>
      <div className="mb-5 overflow-hidden rounded-xl border border-border">
        <div className="relative aspect-video bg-gradient-to-br from-red-950 to-slate-950">
          {/* eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect */}
          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
          {v.durationSec ? <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 text-[11px] font-semibold">{clock(v.durationSec)}</span> : null}
        </div>
        <div className="px-3 py-2.5">
          <p className="line-clamp-2 text-sm font-semibold">{m?.title ?? "Chưa có tiêu đề"}</p>
          <p className="mt-0.5 text-xs text-muted">{data.youtube.channel ?? data.series.title}</p>
        </div>
      </div>

      {(v.youtubeVideoId || v.youtubeShortId) && (
        <Sec title="Số liệu YouTube">
          <YtStats longId={v.youtubeVideoId} shortId={v.youtubeShortId} large />
          <p className="mt-1.5 text-[11px] text-muted">Cập nhật mỗi phút · YouTube báo lượt xem trễ vài phút</p>
        </Sec>
      )}

      <Sec title="Kênh YouTube">
        {data.youtube.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              <span className="text-emerald-400">●</span> {data.youtube.channel ?? "Đã kết nối"}
            </span>
            <div className="flex gap-2">
              <a href="/api/youtube/connect" className="btn-secondary !px-3 !py-1.5 text-xs">
                Kết nối lại
              </a>
              <ActionForm action={disconnectYoutubeAction} submitLabel="Ngắt" variant="secondary" />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">Chưa kết nối — video sẽ chờ đăng tay.</p>
            <a href="/api/youtube/connect" className="btn-primary inline-block">
              Kết nối YouTube
            </a>
          </div>
        )}
      </Sec>

      <Sec title="Đăng tự động" right={auto.note && <span className="text-[11px] text-emerald-400">{auto.note}</span>}>
        <Toggle on={auto.value} onChange={auto.save} label="Render xong tự upload + lên lịch" />
        <Row k="Trạng thái" v={<span className={v.uploadStatus === "failed" ? "text-red-400" : ""}>{UPLOAD_TEXT[v.uploadStatus]}</span>} />
        <Row k="Nhãn AI" v="Có — khai báo nội dung do AI tạo khi đăng" />
        {data.compiledInto && (
          <Row
            k="Bản gộp"
            v={
              <a href={data.compiledInto.youtubeVideoId ? `https://youtu.be/${data.compiledInto.youtubeVideoId}` : `/videos/${data.compiledInto.id}`} className="text-sky-400 underline">
                Trong bản gộp chương {data.compiledInto.from}–{data.compiledInto.to}
              </a>
            }
          />
        )}
        <Row k="Video dài" v={v.publishAt ? formatSlot(v.publishAt) : "—"} />
        <Row k="Short" v={hasShort && v.publishAt ? formatSlot(new Date(Date.parse(v.publishAt) + 2 * 3600_000).toISOString()) : "không có Short"} />
        {v.youtubeVideoId && <Row k="Link video" v={link(v.youtubeVideoId)} />}
        {v.youtubeShortId && <Row k="Link Short" v={link(v.youtubeShortId)} />}
        {!v.youtubeVideoId && v.youtubeUrl && (
          <Row
            k="Link"
            v={
              <a href={v.youtubeUrl} target="_blank" className="text-sky-400 underline">
                Xem trên YouTube
              </a>
            }
          />
        )}
        {v.uploadStatus === "failed" && (
          <div className="mt-3 space-y-2">
            {v.uploadError && <Code>{v.uploadError}</Code>}
            <ActionForm action={retryPublishAction.bind(null, v.id)} submitLabel="↻ Đăng lại" />
          </div>
        )}
        {v.uploadStatus === "none" && v.status === "ready" && data.youtube.connected && !v.youtubeVideoId && (
          <div className="mt-3">
            <ActionForm action={retryPublishAction.bind(null, v.id)} submitLabel="▶ Đăng lên YouTube ngay" />
          </div>
        )}
        {v.uploadStatus === "scheduled" && (
          <p className="mt-3 rounded-lg bg-amber-950/40 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
            Nếu project Google chưa qua audit, YouTube khoá video ở chế độ riêng tư dù đã lên lịch — vào YouTube Studio bấm công khai (xem README).
          </p>
        )}
      </Sec>

      {m && v.status === "ready" && v.uploadStatus !== "uploading" && (
        <Sec title="Đăng tay">
          <div className="mb-3 flex flex-wrap gap-2">
            <CopyButton text={m.title} label="Copy tiêu đề" />
            <CopyButton text={m.description} label="Copy mô tả" />
            <CopyButton text={m.tags.join(", ")} label="Copy tag" />
            {hasShort && <CopyButton text={`${m.shortTitle}\n\n${m.shortDescription}`} label="Copy tiêu đề Short" />}
          </div>
          <ActionForm action={markPublishedAction.bind(null, v.id)} submitLabel="Đã đăng" className="space-y-2">
            <input name="youtubeUrl" placeholder="Link YouTube (tuỳ chọn)" className="field" />
          </ActionForm>
        </Sec>
      )}
    </>
  );
}

export const PANELS: Record<CardId, (p: PanelProps) => ReactNode> = {
  trends: Trends,
  chapter: Chapter,
  seo: Seo,
  tts: Tts,
  images: Images,
  video: VideoOut,
  youtube: Youtube,
};
