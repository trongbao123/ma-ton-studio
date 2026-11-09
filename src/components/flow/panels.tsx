"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { markPublishedAction } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { formatSlot, formatTime, type FlowData, type NodeId } from "@/lib/flow/model";

export type Tab = "out" | "in" | "log";
type PanelProps = { data: FlowData; tab: Tab };

const PENDING = "Chưa có dữ liệu — sẽ có ở bản cập nhật pipeline.";

export function Empty({ text = PENDING }: { text?: string }) {
  return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted">{text}</p>;
}

function Sec({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-5">
      <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h4>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-border py-1.5 text-xs">
      <span className="text-muted">{k}</span>
      <span className="text-right">{v}</span>
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
      <Sec title="Đoạn mở">{c.opening ? <Code>{c.opening}…</Code> : <Empty text="Chương chưa có nội dung." />}</Sec>
      <Link href={`/chapters/${c.id}`} className="btn-secondary inline-block">
        Mở chương →
      </Link>
    </>
  );
}

function Agent({ data, tab }: PanelProps) {
  const m = data.video.meta;
  if (tab === "in")
    return (
      <>
        <Sec title="Memory · Story bible">
          <More text={data.series.bibleExcerpt || "—"} />
        </Sec>
        <Sec title="Tóm tắt chương trước">
          <More text={data.prevSummary ?? "Chương đầu — chưa có tóm tắt."} />
        </Sec>
        <Sec title="Prompt đã gửi">
          <Empty />
        </Sec>
      </>
    );
  if (tab === "log") return <Empty />;
  if (!m) return <Empty text="AI Agent chưa trả kết quả cho video này." />;
  return (
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
      <Sec title="Chat model">
        <p className="text-xs text-muted">Gemini — model cụ thể từng video sẽ được ghi ở bản cập nhật pipeline.</p>
      </Sec>
    </>
  );
}

function Tts({ data, tab }: PanelProps) {
  if (tab !== "out") return <Empty />;
  const d = data.video.durationSec;
  return (
    <>
      <Sec title="Nghe thử">
        <Empty text="Chưa lưu file giọng đọc riêng — nghe trong video ở node Dựng video." />
      </Sec>
      <Sec title="Thông tin">
        <Row k="Thời lượng" v={d ? `${Math.floor(d / 60)} phút ${d % 60} giây` : "—"} />
        <Row k="Chất giọng" v={<span className="line-clamp-2">{data.series.voiceStyle}</span>} />
      </Sec>
    </>
  );
}

function Images({ data, tab }: PanelProps) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (tab !== "out") return <Empty />;
  const thumb = data.video.files["thumbnail.jpg"];
  return (
    <>
      <Sec title="Thumbnail">
        {thumb ? (
          <button type="button" onClick={() => setZoom(thumb)} className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element -- file từ GitHub Release qua redirect, không tối ưu được bằng next/image */}
            <img src={thumb} alt="Thumbnail" className="aspect-video w-full object-cover" />
          </button>
        ) : (
          <Empty text="Video này không có thumbnail." />
        )}
      </Sec>
      <Sec title="Ảnh từng cảnh">
        <Empty text="Chưa lưu ảnh từng cảnh — sẽ có ở bản cập nhật pipeline." />
      </Sec>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portal ra body: inspector có `translate` nên `fixed` bên trong bị giam trong khung inspector.
  return createPortal(
    <div onClick={onClose} className="fixed inset-0 z-50 grid cursor-zoom-out place-items-center bg-black/85 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- như trên */}
      <img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
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
  const { files, error, runUrl } = data.video;
  if (tab === "in") return <Empty text="Đầu vào là giọng đọc + ảnh cảnh ở các node trước." />;
  if (tab === "log")
    return error || runUrl ? (
      <>
        {error && <Code>{error}</Code>}
        {runUrl && (
          <a href={runUrl} target="_blank" className="mt-3 inline-block text-xs text-sky-400 underline">
            Xem log render trên GitHub
          </a>
        )}
      </>
    ) : (
      <Empty text="Không có lỗi." />
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

function Youtube({ data, tab }: PanelProps) {
  if (tab !== "out") return <Empty />;
  const v = data.video;
  const m = v.meta;
  const thumb = v.files["thumbnail.jpg"];
  return (
    <>
      <div className="mb-5 overflow-hidden rounded-xl border border-border">
        <div className="relative aspect-video bg-gradient-to-br from-red-950 to-slate-950">
          {/* eslint-disable-next-line @next/next/no-img-element -- như trên */}
          {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
          {v.durationSec && (
            <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 text-[11px] font-semibold">
              {Math.floor(v.durationSec / 60)}:{String(v.durationSec % 60).padStart(2, "0")}
            </span>
          )}
        </div>
        <div className="px-3 py-2.5">
          <p className="line-clamp-2 text-sm font-semibold">{m?.title ?? "Chưa có tiêu đề"}</p>
          <p className="mt-0.5 text-xs text-muted">{data.series.title}</p>
        </div>
      </div>
      <Sec title="Lịch đăng">
        <Row k="Video dài" v={v.publishAt ? formatSlot(v.publishAt) : "—"} />
        <Row k="Short" v={v.publishAt ? `${formatSlot(new Date(Date.parse(v.publishAt) + 2 * 3600_000).toISOString())}` : "—"} />
        <Row k="Tự đăng" v={<span className="text-muted">sẽ có ở bản cập nhật pipeline</span>} />
        {v.youtubeUrl && (
          <Row
            k="Link"
            v={
              <a href={v.youtubeUrl} target="_blank" className="text-sky-400 underline">
                Xem trên YouTube
              </a>
            }
          />
        )}
      </Sec>
      {m && (
        <Sec title="Đăng tay">
          <div className="mb-3 flex flex-wrap gap-2">
            <CopyButton text={m.title} label="Copy tiêu đề" />
            <CopyButton text={m.description} label="Copy mô tả" />
            <CopyButton text={m.tags.join(", ")} label="Copy tag" />
            <CopyButton text={`${m.shortTitle}\n\n${m.shortDescription}`} label="Copy tiêu đề Short" />
          </div>
          {v.status === "ready" && (
            <ActionForm action={markPublishedAction.bind(null, v.id)} submitLabel="Đã đăng" className="space-y-2">
              <input name="youtubeUrl" placeholder="Link YouTube (tuỳ chọn)" className="field" />
            </ActionForm>
          )}
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
