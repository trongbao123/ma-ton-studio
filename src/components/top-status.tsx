import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { BrandIcon } from "@/components/brand-icons";
import { Lamp } from "@/components/usage-lamp";
import { isAuthorized } from "@/lib/auth";
import { LAMP_TEXT, lampOf, type Lamp as LampState, type SourceDay } from "@/lib/ai/sources";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { topStatus } from "@/lib/usage-data";

/** Trang kênh trên YouTube (đổi kênh thì đặt YOUTUBE_CHANNEL_URL). */
const CHANNEL_URL = process.env.YOUTUBE_CHANNEL_URL ?? "https://www.youtube.com/@MaTonTruyen";

/**
 * Thanh trên cùng: video đang render (bấm để mở) + đèn hạn mức từng AI (bấm sang trang Hạn mức) + kênh YouTube.
 * Chỉ hiện khi đã đăng nhập — layout cũng bọc trang /login nên không được lộ dữ liệu ở đó.
 */
export async function TopStatus() {
  await connection();
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER;
  const authed =
    (await verifySession((await cookies()).get(SESSION_COOKIE)?.value, password, user)) ||
    isAuthorized((await headers()).get("authorization"), password, user);
  if (!authed) return null;

  const s = await topStatus().catch(() => null);
  if (!s) return null;
  const merge = (...days: (SourceDay | undefined)[]): SourceDay | undefined =>
    days.some(Boolean)
      ? {
          calls: days.reduce((n, d) => n + (d?.calls ?? 0), 0),
          limited: days.every((d) => !d || d.limited),
          partial: days.some((d) => d?.limited || d?.partial),
          models: [],
        }
      : undefined;
  const lamps: { key: string; label: string; brand: "claude" | "openai" | "gemini" | "cloudflare"; lamp: LampState; calls: number }[] = [
    { key: "claude", label: "Claude", brand: "claude", lamp: lampOf(s.today["claude-plan"], Boolean(s.cli["claude-cli"]?.ok)), calls: s.today["claude-plan"]?.calls ?? 0 },
    { key: "chatgpt", label: "ChatGPT", brand: "openai", lamp: lampOf(s.today["chatgpt-plan"], Boolean(s.cli["codex-cli"]?.ok)), calls: s.today["chatgpt-plan"]?.calls ?? 0 },
    (() => {
      const d = merge(s.today["gemini-free"], s.today.voice);
      return { key: "gemini", label: "Gemini", brand: "gemini" as const, lamp: lampOf(d, true), calls: d?.calls ?? 0 };
    })(),
    (() => {
      // Ảnh: chỉ đỏ khi mọi nguồn vẽ đều chạm giới hạn (Cloudflare hết mà DeepInfra còn thì vẫn vẽ được).
      const cf = s.today.cloudflare;
      const di = s.today.deepinfra;
      const d = merge(cf, di);
      const lamp: LampState = cf?.limited && !di?.calls ? "limited" : cf?.limited ? "partial" : d?.calls ? "active" : "idle";
      return { key: "images", label: "Ảnh", brand: "cloudflare" as const, lamp, calls: d?.calls ?? 0 };
    })(),
  ];

  return (
    <div className="flex w-full items-center gap-4">
      <div className="min-w-0 flex-1 text-sm">
        {s.rendering ? (
          <Link href={`/videos/${s.rendering.id}`} className="inline-flex max-w-full items-center gap-2 rounded-full bg-sky-500/10 px-3 py-1 text-sky-200 hover:bg-sky-500/15">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-400" />
            <span className="truncate">
              Đang render chương {s.rendering.number}
              {s.queued ? ` · còn ${s.queued} video chờ` : ""}
            </span>
          </Link>
        ) : s.queued ? (
          <Link href="/videos?loc=running" className="text-muted hover:text-foreground">
            {s.queued} video chờ render
          </Link>
        ) : (
          <span className="text-muted">Không có video đang làm</span>
        )}
      </div>
      <Link href="/usage" aria-label="Xem hạn mức AI" className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card/70 px-1.5 py-1 hover:border-zinc-600">
        {lamps.map((l) => (
          <span key={l.key} title={`${l.label}: ${LAMP_TEXT[l.lamp]} · ${l.calls} lượt hôm nay`} className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs">
            <BrandIcon id={l.brand} size={13} />
            <span className="hidden xl:inline">{l.label}</span>
            <Lamp lamp={l.lamp} />
          </span>
        ))}
      </Link>
      <a
        href={CHANNEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={s.channel ? `Mở kênh ${s.channel} trên YouTube` : "Mở kênh YouTube (chưa kết nối để tự đăng)"}
        className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-card/70 px-3 py-1 text-xs hover:border-red-500/50 hover:text-white md:flex"
      >
        <BrandIcon id="youtube" size={14} />
        <span className={s.channel ? "" : "text-muted"}>{s.channel ?? "Chưa kết nối"}</span>
        <ExternalLink size={11} className="text-muted" />
      </a>
    </div>
  );
}
