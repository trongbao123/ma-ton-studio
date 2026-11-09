"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { disconnectYoutubeAction, markPublishedAction, retryPublishAction, updateFlowSettingsAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { formatSlot, formatTime, type FlowData, type NodeId } from "@/lib/flow/model";
import type { Scene } from "@/lib/flow/progress";
import { VOICES } from "@/lib/flow/voices";

export type Tab = "out" | "in" | "log";
type PanelProps = { data: FlowData; tab: Tab };

const PENDING = "Chưa có dữ liệu — video này render trước khi có ghi tiến độ, render lại để xem.";

export function Empty({ text = PENDING }: { text?: string }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted">{text}</p>;
}

function Sec({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-border py-1.5 text-xs">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="min-w-0 text-right">{v}</span>
    </div>
  );
}

const Code = ({ children }: { children: ReactNode }) => (
  <div className="whitespace-pre-wrap break-words rounded-xl border border-border bg-[#0e0e12] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-300">
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

function Trigger({ data, tab }: PanelProps) {
  if (tab !== "out") return <Empty text="Bước này không có đầu vào hay nhật ký riêng." />;
  const c = data.chapter;
  return (
    <>
      <Sec title={`Chương ${c.number}`}>
        <Row k="Tiêu đề" v={c.title} />
        <Row k="Độ dài" v={`${c.words.toLocaleString("vi-VN")} chữ`} />
        <Row k="Duyệt lúc" v={formatTime(c.approvedAt)} />
      </Sec>
      <Sec title="Đoạn mở">
        {c.opening ? (
          <Code>
            {c.opening}
            {c.opening.length >= 400 ? "…" : ""}
          </Code>
        ) : (
          <Empty text="Chương chưa có nội dung." />
        )}
      </Sec>
      <Link href={`/chapters/${c.id}`} className="btn-secondary inline-block">
        Mở chương →
      </Link>
    </>
  );
}

function Agent({ data, tab }: PanelProps) {
  const m = data.video.meta;
  const prompts = data.video.progress?.prompts;
  if (tab === "in")
    return (
      <>
        <Sec title="Memory · Story bible">
          <More text={data.series.bibleExcerpt || "—"} />
        </Sec>
        <Sec title="Tóm tắt chương trước">
          <More text={data.prevSummary ?? "Chương đầu — chưa có tóm tắt."} />
        </Sec>
        <Sec title="Prompt tiêu đề / mô tả">{prompts?.meta ? <More text={prompts.meta} /> : <Empty />}</Sec>
        <Sec title="Prompt chia cảnh">{prompts?.scenes ? <More text={prompts.scenes} /> : <Empty />}</Sec>
      </>
    );
  if (tab === "log") return <StepLog data={data} id="agent" />;
  const model = data.video.progress?.steps.agent?.model;
  return (
    <>
      <Sec title="Chat model">
        <p className="text-xs">{model ?? <span className="text-muted">Gemini (chưa ghi model cụ thể)</span>}</p>
      </Sec>
      {!m ? (
        <Empty text="AI Agent chưa trả kết quả cho video này." />
      ) : (
        <>
          <Sec title="Tiêu đề YouTube">
            <Code>{m.title}</Code>
          </Sec>
          <Sec title="Mô tả">
            <More text={m.description} />
          </Sec>
          <Sec title="Tag">
            <div className="flex flex-wrap gap-1.5">
              {m.tags.map((t) => (
                <span key={t} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px]">
                  {t}
                </span>
              ))}
            </div>
          </Sec>
          <Sec title="Short">
            <Code>{m.shortTitle}</Code>
          </Sec>
        </>
      )}
    </>
  );
}

function Tts({ data, tab }: PanelProps) {
  const voice = useSetting(data.series.id, "ttsVoice", data.series.ttsVoice);
  if (tab === "in") return <Empty text="Đầu vào là nội dung chương và kịch bản Short (node AI Agent)." />;
  if (tab === "log") return <StepLog data={data} id="tts" />;
  const d = data.video.durationSec;
  const { files } = data.video;
  return (
    <>
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
          <Empty text="Chưa có file nghe thử — nghe trong video ở node Dựng video." />
        )}
      </Sec>
      <Sec title="Giọng đọc" right={voice.note && <span className="text-[11px] text-emerald-400">{voice.note}</span>}>
        <select value={voice.value} onChange={(e) => voice.save(e.target.value)} className="field">
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id} — {v.note}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-muted">Áp dụng cho cả bộ truyện từ lần render sau.</p>
      </Sec>
      <Sec title="Thông tin">
        <Row k="Thời lượng" v={d ? `${Math.floor(d / 60)} phút ${d % 60} giây` : "—"} />
        <Row k="Chất giọng mong muốn" v={<span className="line-clamp-2">{data.series.voiceStyle}</span>} />
      </Sec>
    </>
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
  return (
    <>
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
  if (tab === "in") return <Empty text="Đầu vào là giọng đọc + ảnh cảnh ở các node trước." />;
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
  if (tab === "in") return <Empty text="Đầu vào: video dài, Short, thumbnail và tiêu đề/mô tả/tag từ AI Agent." />;
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

export const PANELS: Record<NodeId, (p: PanelProps) => ReactNode> = {
  trigger: Trigger,
  agent: Agent,
  tts: Tts,
  images: Images,
  video: VideoOut,
  youtube: Youtube,
};
