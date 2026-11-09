"use client";

import { useState, useTransition } from "react";
import { saveAiRoutingAction, testAiAction, type ActionState } from "@/app/actions";
import { PROVIDERS, TASKS, type AiTask, type ProviderId, type Route, type Routing } from "@/lib/ai/routing";

const label = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!.label;

export function AiRoutingEditor({ initial, available }: { initial: Routing; available: ProviderId[] }) {
  const [routing, setRouting] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [result, setResult] = useState<ActionState>({});
  const [saving, start] = useTransition();

  const update = (task: AiTask, fn: (rows: Route[]) => Route[]) => {
    setRouting((r) => ({ ...r, [task]: fn(r[task]) }));
    setDirty(true);
    setResult({});
  };
  const move = (rows: Route[], i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return rows;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="font-bold">API key</h2>
        <p className="text-xs text-muted">
          Thêm key vào <b>Vercel</b> (web viết truyện) <b>và</b> GitHub → Settings → Secrets → Actions (job tự viết, render video). Thêm xong cần deploy lại
          Vercel.
        </p>
        <ul className="divide-y divide-border">
          {PROVIDERS.map((p) => (
            <KeyRow key={p.id} provider={p.id} env={p.env} ok={available.includes(p.id)} model={routing.story.find((r) => r.provider === p.id)?.model ?? ""} />
          ))}
        </ul>
      </section>

      {TASKS.map((t) => (
        <section key={t.id} className="card space-y-3">
          <div>
            <h2 className="font-bold">{t.label}</h2>
            <p className="text-xs text-muted">{t.note}</p>
          </div>
          <ol className="space-y-2">
            {routing[t.id].map((r, i) => {
              const p = PROVIDERS.find((x) => x.id === r.provider)!;
              const ok = available.includes(r.provider);
              return (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-center text-sm font-bold text-muted">{i + 1}</span>
                  <select
                    value={r.provider}
                    onChange={(e) => update(t.id, (rows) => rows.map((x, k) => (k === i ? { provider: e.target.value as ProviderId, model: "" } : x)))}
                    className="field !w-36"
                  >
                    {PROVIDERS.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.label}
                      </option>
                    ))}
                  </select>
                  <input
                    list={`models-${p.id}`}
                    value={r.model}
                    placeholder={p.id === "gemini" ? "tự chọn (danh sách dự phòng)" : `mặc định: ${p.models[0]}`}
                    onChange={(e) => update(t.id, (rows) => rows.map((x, k) => (k === i ? { ...x, model: e.target.value } : x)))}
                    className="field min-w-0 flex-1 basis-48"
                  />
                  {!ok && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">chưa có key — bỏ qua</span>}
                  <div className="flex gap-1">
                    <button type="button" onClick={() => update(t.id, (rows) => move(rows, i, -1))} className="btn-secondary !px-2 !py-1" aria-label="Lên">
                      ↑
                    </button>
                    <button type="button" onClick={() => update(t.id, (rows) => move(rows, i, 1))} className="btn-secondary !px-2 !py-1" aria-label="Xuống">
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={routing[t.id].length <= 1}
                      onClick={() => update(t.id, (rows) => rows.filter((_, k) => k !== i))}
                      className="btn-secondary !px-2 !py-1"
                      aria-label="Xoá"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {routing[t.id].length < 6 && (
            <button
              type="button"
              onClick={() => update(t.id, (rows) => [...rows, { provider: available[0] ?? "gemini", model: "" }])}
              className="text-sm text-accent hover:underline"
            >
              + Thêm AI dự phòng
            </button>
          )}
        </section>
      ))}

      {PROVIDERS.map((p) => (
        <datalist key={p.id} id={`models-${p.id}`}>
          {p.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      ))}

      <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-lg">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() =>
            start(async () => {
              const r = await saveAiRoutingAction(routing);
              setResult(r);
              if (!r.error) setDirty(false);
            })
          }
          className="btn-primary"
        >
          {saving ? "Đang lưu…" : "Lưu cài đặt"}
        </button>
        {result.error && <span className="text-sm text-red-500">{result.error}</span>}
        {result.ok && <span className="text-sm text-emerald-500">{result.ok}</span>}
        {dirty && !saving && <span className="text-sm text-muted">Có thay đổi chưa lưu</span>}
      </div>
    </div>
  );
}

function KeyRow({ provider, env, ok, model }: { provider: ProviderId; env: string; ok: boolean; model: string }) {
  const [res, setRes] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span className="w-20 font-medium">{label(provider)}</span>
      <code className="text-xs text-muted">{env}</code>
      <span className={ok ? "text-emerald-500" : "text-muted"}>{ok ? "✓ đã có key" : "✗ chưa có key"}</span>
      {ok && (
        <button type="button" disabled={pending} onClick={() => start(async () => setRes(await testAiAction(provider, model)))} className="btn-secondary !px-3 !py-1 text-xs">
          {pending ? "Đang thử…" : "Thử"}
        </button>
      )}
      {res.error && <span className="basis-full text-xs text-red-500">{res.error}</span>}
      {res.ok && <span className="basis-full text-xs text-emerald-500">{res.ok}</span>}
    </li>
  );
}
