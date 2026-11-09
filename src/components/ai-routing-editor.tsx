"use client";

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { saveAiRoutingAction, testAiAction, type ActionState } from "@/app/actions";
import { BrandIcon, type BrandId } from "@/components/brand-icons";
import { IMAGE_PROVIDERS, PROVIDERS, TASKS, type AiTask, type ImageRoute, type ProviderId, type Routing } from "@/lib/ai/routing";

const BRAND: Record<string, BrandId> = { anthropic: "claude", openai: "openai", gemini: "gemini", cloudflare: "cloudflare" };

type Option = { id: string; label: string; models: string[]; placeholder: string; note?: string };
type Row = { provider: string; model: string };

const TEXT_OPTIONS: Option[] = PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
  models: p.models,
  placeholder: p.id === "gemini" ? "tự chọn (danh sách dự phòng)" : `mặc định ${p.models[0]}`,
}));
const IMAGE_OPTIONS: Option[] = IMAGE_PROVIDERS.map((p) => ({ id: p.id, label: p.label, models: p.models, placeholder: `mặc định ${p.models[0]}`, note: p.note }));

function move<T>(rows: T[], i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Danh sách AI theo thứ tự ưu tiên: chọn hãng, model, đổi thứ tự, xoá, thêm dự phòng. */
function RouteList({ rows, options, missing, onChange, listId }: { rows: Row[]; options: Option[]; missing?: (id: string) => boolean; onChange: (rows: Row[]) => void; listId: string }) {
  return (
    <>
      <ol className="space-y-2.5">
        {rows.map((r, i) => {
          const opt = options.find((o) => o.id === r.provider)!;
          return (
            <li key={i} className={`flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-[#12131a] p-2.5 md:flex-nowrap ${missing?.(r.provider) ? "opacity-60" : ""}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.04]">
                <BrandIcon id={BRAND[r.provider]} size={18} />
              </span>
              <select
                value={r.provider}
                aria-label="Hãng AI"
                onChange={(e) => onChange(rows.map((x, k) => (k === i ? { provider: e.target.value, model: "" } : x)))}
                className="field !w-40 shrink-0"
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                list={`${listId}-${opt.id}`}
                value={r.model}
                aria-label="Model"
                placeholder={opt.placeholder}
                onChange={(e) => onChange(rows.map((x, k) => (k === i ? { ...x, model: e.target.value } : x)))}
                className="field min-w-0 flex-1 basis-40"
              />
              {missing?.(r.provider) && <span className="shrink-0 whitespace-nowrap rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">chưa có key</span>}
              {opt.note && <span className="shrink-0 whitespace-nowrap text-xs text-muted">{opt.note}</span>}
              <div className="ml-auto flex shrink-0 gap-1">
                <button type="button" onClick={() => onChange(move(rows, i, -1))} disabled={i === 0} className="btn-secondary !p-1.5" aria-label="Đưa lên">
                  <ArrowUp size={15} />
                </button>
                <button type="button" onClick={() => onChange(move(rows, i, 1))} disabled={i === rows.length - 1} className="btn-secondary !p-1.5" aria-label="Đưa xuống">
                  <ArrowDown size={15} />
                </button>
                <button type="button" disabled={rows.length <= 1} onClick={() => onChange(rows.filter((_, k) => k !== i))} className="btn-secondary !p-1.5" aria-label="Xoá">
                  <X size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {rows.length < 6 && (
        <button
          type="button"
          onClick={() => onChange([...rows, { provider: options.find((o) => !rows.some((r) => r.provider === o.id))?.id ?? options[0].id, model: "" }])}
          className="flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          <Plus size={15} /> Thêm AI dự phòng
        </button>
      )}
      {options.map((o) => (
        <datalist key={o.id} id={`${listId}-${o.id}`}>
          {o.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ))}
    </>
  );
}

export function AiRoutingEditor({ initial, initialImages, available }: { initial: Routing; initialImages: ImageRoute[]; available: ProviderId[] }) {
  const [routing, setRouting] = useState(initial);
  const [images, setImages] = useState(initialImages);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ActionState>({});
  const [saving, start] = useTransition();
  const touch = () => {
    setDirty(true);
    setResult({});
  };

  return (
    <div className="space-y-10 pb-24">
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Kết nối</h2>
        <p className="max-w-3xl text-sm text-muted">
          Key đặt ở Vercel dùng cho web (viết chương, tạo truyện). Job tự viết và render video chạy trên GitHub Actions, nên phải đặt cùng key ở GitHub, mục Settings,
          Secrets, Actions. Thêm key xong thì deploy lại Vercel.
        </p>
        <ul className="grid gap-3 md:grid-cols-3">
          {PROVIDERS.map((p) => (
            <KeyCard key={p.id} provider={p.id} env={p.env} ok={available.includes(p.id)} model={routing.story.find((r) => r.provider === p.id)?.model ?? ""} />
          ))}
        </ul>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">AI cho từng việc</h2>
          <p className="mt-1 text-sm text-muted">Thứ tự từ trên xuống. AI đầu lỗi, hết tiền hoặc từ chối viết thì tự chuyển AI kế tiếp.</p>
        </div>
        <div className="grid gap-8 xl:grid-cols-2">
          {TASKS.map((t) => (
            <div key={t.id} className="space-y-3">
              <div>
                <h3 className="font-semibold">{t.label}</h3>
                <p className="text-xs text-muted">{t.note}</p>
              </div>
              <RouteList
                listId={`m-${t.id}`}
                rows={routing[t.id]}
                options={TEXT_OPTIONS}
                missing={(id) => !available.includes(id as ProviderId)}
                onChange={(rows) => {
                  setRouting((r) => ({ ...r, [t.id as AiTask]: rows as Routing[AiTask] }));
                  touch();
                }}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-4xl space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Vẽ ảnh cảnh và thumbnail</h2>
          <p className="mt-1 text-sm text-muted">
            Chạy trong job render trên GitHub nên dùng key ở GitHub Secrets. Chỉ có Cloudflare thì hết quota video chờ hôm sau. Thêm Gemini hoặc GPT Image làm dự phòng
            thì video không phải chờ, nhưng tính tiền theo ảnh và nét vẽ có thể lệch giữa các cảnh.
          </p>
        </div>
        <RouteList
          listId="img"
          rows={images}
          options={IMAGE_OPTIONS}
          onChange={(rows) => {
            setImages(rows as ImageRoute[]);
            touch();
          }}
        />
      </section>

      <div className="fixed inset-x-4 bottom-4 z-10 mx-auto flex max-w-3xl items-center gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,.5)] backdrop-blur lg:left-[calc(248px+2.5rem)]">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() =>
            start(async () => {
              const r = await saveAiRoutingAction(routing, images);
              setResult(r);
              if (!r.error) setDirty(false);
            })
          }
          className="btn-primary"
        >
          {saving ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
        {result.error && <span className="text-sm text-red-400">{result.error}</span>}
        {result.ok && <span className="text-sm text-jade">{result.ok}</span>}
        {!result.ok && !result.error && <span className="text-sm text-muted">{dirty ? "Có thay đổi chưa lưu" : "Không có thay đổi"}</span>}
      </div>
    </div>
  );
}

function KeyCard({ provider, env, ok, model }: { provider: ProviderId; env: string; ok: boolean; model: string }) {
  const [res, setRes] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const label = PROVIDERS.find((p) => p.id === provider)!.label;
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/[.04]">
          <BrandIcon id={BRAND[provider]} size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{label}</p>
          <code className="text-xs text-muted">{env}</code>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${ok ? "bg-jade/15 text-jade" : "bg-white/[.05] text-muted"}`}>{ok ? "Đã có key" : "Chưa có key"}</span>
      </div>
      {ok && (
        <button type="button" disabled={pending} onClick={() => start(async () => setRes(await testAiAction(provider, model)))} className="btn-secondary w-full !py-1.5 text-xs">
          {pending ? "Đang gọi thử…" : "Gọi thử"}
        </button>
      )}
      {res.error && <p className="text-xs text-red-400">{res.error}</p>}
      {res.ok && <p className="text-xs text-jade">{res.ok}</p>}
    </li>
  );
}
