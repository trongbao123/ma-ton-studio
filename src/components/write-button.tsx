"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { writeChapterAction } from "@/app/actions";

/** Điều phối viết chương nhiều lượt (mỗi lượt là 1 request riêng để không vượt giới hạn thời gian của Vercel). */
export function WriteButton({ chapterId, label, variant = "secondary" }: { chapterId: number; label: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  async function run() {
    setError(undefined);
    setStatus("AI đang viết…");
    let r = await writeChapterAction(chapterId, "start");
    for (let i = 0; i < 5 && !("error" in r) && !r.enough; i++) {
      setStatus(`Đã ${r.words} từ, viết tiếp…`);
      r = await writeChapterAction(chapterId, "continue");
    }
    if (!("error" in r)) {
      setStatus(`${r.words} từ, đang tóm tắt…`);
      r = await writeChapterAction(chapterId, "finish");
    }
    setStatus(undefined);
    if ("error" in r) setError(r.error);
    router.refresh();
  }

  return (
    <span className="flex items-center gap-3">
      <button type="button" onClick={run} disabled={!!status} className={variant === "primary" ? "btn-primary" : "btn-secondary"}>
        {status ?? label}
      </button>
      {error && <span className="text-sm text-red-500">{error}</span>}
    </span>
  );
}
