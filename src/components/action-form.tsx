"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/app/actions";

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
  className?: string;
  children?: ReactNode;
};

/** Form gọi server action, hiện trạng thái chờ và kết quả. Việc gọi AI có thể mất 1–3 phút. */
export function ActionForm({ action, submitLabel, pendingLabel, variant = "primary", className, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={variant === "primary" ? "btn-primary" : "btn-secondary"}>
          {pending ? (pendingLabel ?? "Đang xử lý…") : submitLabel}
        </button>
        {!pending && state.error && <span className="text-sm text-red-500">{state.error}</span>}
        {!pending && state.ok && <span className="text-sm text-emerald-500">{state.ok}</span>}
      </div>
    </form>
  );
}
