"use client";

import {
  ArrowDown,
  Image as ImageIcon,
  ArrowUp,
  KeyRound,
  Lock,
  Plus,
  TrendingUp,
  X,
} from "lucide-react";
import { useState, useTransition } from "react";
import {
  saveAiRoutingAction,
  saveSecretAction,
  testAiAction,
  type ActionState,
} from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { BrandIcon, type BrandId } from "@/components/brand-icons";
import {
  DEFAULT_MODEL,
  IMAGE_PROVIDERS,
  isCli,
  PROVIDERS,
  TASKS,
  type AiTask,
  type ImageRoute,
  type ProviderId,
  type Routing,
} from "@/lib/ai/routing";
import {
  SECRET_KEYS,
  type SecretKey,
  type SecretStatus,
} from "@/lib/secret-keys";
import type { CliCheck, CliStatus } from "@/lib/ai/cli-status";
import { CopyButton } from "@/components/copy-button";

const BRAND: Record<string, BrandId> = {
  ...Object.fromEntries(PROVIDERS.map((p) => [p.id, p.brand])),
  cloudflare: "cloudflare",
};

type Option = {
  id: string;
  label: string;
  models: string[];
  placeholder: string;
  note?: string;
};
type Row = { provider: string; model: string };

const TEXT_OPTIONS: Option[] = PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
  models: p.models,
  placeholder: p.cli
    ? "model mặc định của gói"
    : DEFAULT_MODEL[p.id]
      ? `mặc định ${DEFAULT_MODEL[p.id]}`
      : "tự chọn (danh sách dự phòng)",
}));
const IMAGE_OPTIONS: Option[] = IMAGE_PROVIDERS.map((p) => ({
  id: p.id,
  label: p.label,
  models: p.models,
  placeholder: `mặc định ${p.models[0]}`,
  note: p.note,
}));

function move<T>(rows: T[], i: number, d: -1 | 1) {
  const j = i + d;
  if (j < 0 || j >= rows.length) return rows;
  const next = [...rows];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Danh sách AI theo thứ tự ưu tiên: chọn hãng, model, đổi thứ tự, xoá, thêm dự phòng. */
function RouteList({
  rows,
  options,
  missing,
  onChange,
  listId,
}: {
  rows: Row[];
  options: Option[];
  missing?: (id: string) => boolean;
  onChange: (rows: Row[]) => void;
  listId: string;
}) {
  return (
    <>
      <ol className="space-y-2.5">
        {rows.map((r, i) => {
          const opt = options.find((o) => o.id === r.provider)!;
          return (
            <li
              key={i}
              className={`flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-[#12131a] p-2.5 md:flex-nowrap ${missing?.(r.provider) ? "opacity-60" : ""}`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[.04]">
                {BRAND[r.provider] ? <BrandIcon id={BRAND[r.provider]} size={18} /> : <ImageIcon size={17} className="text-sky-300" />}
              </span>
              <select
                value={r.provider}
                aria-label="Hãng AI"
                onChange={(e) =>
                  onChange(
                    rows.map((x, k) =>
                      k === i ? { provider: e.target.value, model: "" } : x,
                    ),
                  )
                }
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
                onChange={(e) =>
                  onChange(
                    rows.map((x, k) =>
                      k === i ? { ...x, model: e.target.value } : x,
                    ),
                  )
                }
                className="field min-w-0 flex-1 basis-40"
              />
              {missing?.(r.provider) && (
                <span className="shrink-0 whitespace-nowrap rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold">
                  chưa có key
                </span>
              )}
              {opt.note && (
                <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                  {opt.note}
                </span>
              )}
              <div className="ml-auto flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onChange(move(rows, i, -1))}
                  disabled={i === 0}
                  className="btn-secondary !p-1.5"
                  aria-label="Đưa lên"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(move(rows, i, 1))}
                  disabled={i === rows.length - 1}
                  className="btn-secondary !p-1.5"
                  aria-label="Đưa xuống"
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  disabled={rows.length <= 1}
                  onClick={() => onChange(rows.filter((_, k) => k !== i))}
                  className="btn-secondary !p-1.5"
                  aria-label="Xoá"
                >
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
          onClick={() =>
            onChange([
              ...rows,
              {
                provider:
                  options.find((o) => !rows.some((r) => r.provider === o.id))
                    ?.id ?? options[0].id,
                model: "",
              },
            ])
          }
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

export function AiRoutingEditor({
  initial,
  initialImages,
  available,
  secrets,
  cli,
}: {
  initial: Routing;
  initialImages: ImageRoute[];
  available: ProviderId[];
  secrets: SecretStatus[];
  cli: CliStatus;
}) {
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
        <p className="flex max-w-3xl items-start gap-2 text-sm text-muted">
          <Lock size={15} className="mt-0.5 shrink-0 text-jade" />
          Dán key một lần ở đây là web và job render trên GitHub đều dùng được
          ngay, không cần deploy lại. Key được mã hoá trước khi lưu và không bao
          giờ hiện lại đầy đủ, chỉ 4 ký tự cuối.
        </p>
        <h3 className="pt-2 font-semibold">
          Gói Pro / Plus — không tốn credit API
        </h3>
        <ul className="grid gap-3 md:grid-cols-3">
          {PROVIDERS.filter((p) => p.cli).map((p) => (
            <PlanCard
              key={p.id}
              id={p.id}
              label={p.label}
              brand={p.brand}
              check={cli[p.id]}
              note={p.note}
            />
          ))}
        </ul>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Kết nối hoặc đăng nhập lại Claude + ChatGPT: chạy trên máy bạn{" "}
          <code className="rounded bg-white/[.06] px-1.5 py-0.5 text-zinc-200">
            {LOGIN_CMD}
          </code>
          <CopyButton text={LOGIN_CMD} label="Copy lệnh" /> — chỉ cần bấm Cho
          phép trên trình duyệt, còn lại tự lưu và tự kiểm tra.
        </p>
        <h3 className="pt-2 font-semibold">API (trả theo lượng dùng)</h3>
        <ul className="grid gap-3 md:grid-cols-3">
          {SECRET_KEYS.filter(
            (k) => k.group === "ai" && !isCli(providerOf(k.env) ?? "gemini"),
          ).map((k) => (
            <SecretCard
              key={k.env}
              k={k}
              status={secrets.find((x) => x.env === k.env)!}
              testModel={
                routing.story.find((r) => r.provider === providerOf(k.env))
                  ?.model ?? ""
              }
            />
          ))}
        </ul>
        <h3 className="pt-2 font-semibold">Dịch vụ khác</h3>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {SECRET_KEYS.filter((k) => k.group === "service").map((k) => (
            <SecretCard
              key={k.env}
              k={k}
              status={secrets.find((x) => x.env === k.env)!}
            />
          ))}
        </ul>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">AI cho từng việc</h2>
          <p className="mt-1 text-sm text-muted">
            Thứ tự từ trên xuống. AI đầu lỗi, hết tiền hoặc từ chối viết thì tự
            chuyển AI kế tiếp.
          </p>
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
                  setRouting((r) => ({
                    ...r,
                    [t.id as AiTask]: rows as Routing[AiTask],
                  }));
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
            Chạy trong job render trên GitHub nên dùng key ở GitHub Secrets. Chỉ
            có Cloudflare thì hết quota video chờ hôm sau. Thêm Gemini hoặc GPT
            Image làm dự phòng thì video không phải chờ, nhưng tính tiền theo
            ảnh và nét vẽ có thể lệch giữa các cảnh.
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
        {result.error && (
          <span className="text-sm text-red-400">{result.error}</span>
        )}
        {result.ok && <span className="text-sm text-jade">{result.ok}</span>}
        {!result.ok && !result.error && (
          <span className="text-sm text-muted">
            {dirty ? "Có thay đổi chưa lưu" : "Không có thay đổi"}
          </span>
        )}
      </div>
    </div>
  );
}

const providerOf = (env: string) => PROVIDERS.find((p) => p.env === env)?.id;

const LOGIN_CMD = "node scripts/ai-login.mjs";
const when = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Một gói Pro/Plus: đăng nhập nằm ở GitHub Secrets, trạng thái lấy từ lần gọi thử gần nhất (workflow ai-check). */
function PlanCard({
  label,
  brand,
  check,
  note,
}: {
  id: ProviderId;
  label: string;
  brand: BrandId;
  check?: CliCheck;
  note?: string;
}) {
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.04]">
          <BrandIcon id={brand} size={22} />
        </span>
        <p className="min-w-0 flex-1 truncate font-semibold">{label}</p>
        {note && !check?.ok ? (
          <span className="shrink-0 rounded-full bg-white/[.05] px-2.5 py-1 text-xs text-muted">
            Không hỗ trợ
          </span>
        ) : check ? (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${check.ok ? "bg-jade/15 text-jade" : "bg-red-500/15 text-red-300"}`}
          >
            {check.ok ? "Đã kết nối" : "Lỗi"}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-white/[.05] px-2.5 py-1 text-xs text-muted">
            Chưa kết nối
          </span>
        )}
      </div>
      <p className="text-xs text-muted">
        {note && !check?.ok
          ? note
          : check?.ok
            ? `${check.model ?? "model mặc định"} · kiểm tra ${when(check.at)}`
            : check
              ? `${check.error ?? "lỗi"} · ${when(check.at)}`
              : "Chạy lệnh bên dưới trên máy bạn để kết nối."}
      </p>
    </li>
  );
}

const SOURCE: Record<string, [string, string]> = {
  web: ["Đã lưu", "bg-jade/15 text-jade"],
  env: ["Từ biến môi trường", "bg-sky-400/10 text-sky-300"],
};

/** Một ô key: trạng thái (không lộ key), dán key mới, xoá key đã lưu, gọi thử với AI. */
function SecretCard({
  k,
  status,
  testModel,
}: {
  k: SecretKey;
  status: SecretStatus;
  testModel?: string;
}) {
  const [res, setRes] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const provider = providerOf(k.env);
  const tag = status.source ? SOURCE[status.source] : null;
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[.04]">
          {k.brand ? (
            <BrandIcon id={k.brand} size={22} />
          ) : k.env.startsWith("VIDIQ") ? (
            <TrendingUp size={20} className="text-emerald-300" />
          ) : (
            <KeyRound size={20} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{k.label}</p>
          <p className="truncate text-xs text-muted">{k.help}</p>
        </div>
        {tag ? (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${tag[1]}`}
          >
            {tag[0]} {status.hint}
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-white/[.05] px-2.5 py-1 text-xs text-muted">
            Chưa có
          </span>
        )}
      </div>
      <ActionForm
        action={saveSecretAction.bind(null, k.env)}
        submitLabel="Lưu"
        variant="secondary"
        className="flex flex-wrap items-center gap-2"
      >
        <input
          name="value"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={
            status.source ? "Dán key mới để thay" : "Dán key vào đây"
          }
          className="field min-w-0 flex-1 basis-40"
        />
      </ActionForm>
      <div className="flex flex-wrap gap-2">
        {provider && isCli(provider) && status.source && (
          <span className="text-xs text-muted">
            Chạy trong job GitHub Actions (render, viết chương hằng ngày) —
            không gọi thử từ web được.
          </span>
        )}
        {provider && !isCli(provider) && status.source && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () =>
                setRes(await testAiAction(provider, testModel ?? "")),
              )
            }
            className="btn-secondary !px-3 !py-1.5 text-xs"
          >
            {pending ? "Đang gọi thử…" : "Gọi thử"}
          </button>
        )}
        {status.source === "web" && (
          <ActionForm
            action={saveSecretAction.bind(null, k.env)}
            submitLabel="Xoá key đã lưu"
            variant="secondary"
          >
            <input type="hidden" name="remove" value="1" />
          </ActionForm>
        )}
      </div>
      {res.error && <p className="text-xs text-red-400">{res.error}</p>}
      {res.ok && <p className="text-xs text-jade">{res.ok}</p>}
    </li>
  );
}
