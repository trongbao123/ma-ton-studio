"use client";

import { Eye, EyeOff, LogIn } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { loginAction, type LoginState } from "./actions";

function NextField() {
  return <input type="hidden" name="next" value={useSearchParams().get("next") ?? "/"} />;
}

/** `next` truyền sẵn = bản dựng trước khi có URL (Suspense fallback); không thì đọc từ ?next=. */
export function LoginForm({ needUser, next }: { needUser: boolean; next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-4 rounded-2xl border border-border bg-card/80 p-6 shadow-[0_20px_60px_rgba(0,0,0,.45)] backdrop-blur">
      {next != null ? <input type="hidden" name="next" value={next} /> : <NextField />}
      {needUser && (
        <div>
          <label htmlFor="user" className="label">
            Tài khoản
          </label>
          <input id="user" name="user" autoComplete="username" autoFocus required className="field !py-2.5" />
        </div>
      )}
      <div>
        <label htmlFor="password" className="label">
          Mật khẩu
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            autoFocus={!needUser}
            required
            className="field !py-2.5 pr-10"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted hover:text-foreground"
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      {state.error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary flex w-full items-center justify-center gap-2 !py-2.5">
        <LogIn size={16} />
        {pending ? "Đang vào…" : "Vào xưởng"}
      </button>
    </form>
  );
}
