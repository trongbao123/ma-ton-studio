"use client";

import { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/format-count";

const TWEEN_MS = 700;
const FLASH_MS = 1400;

/** Số kiểu 1,2N / 3,4Tr; khi tăng thì nhảy dần lên giá trị mới và loé xanh nhẹ. Giảm chuyển động thì đổi luôn. */
export function AnimatedCount({ value, className = "" }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState(false);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (value === start) return;
    from.current = value;
    const instant = value < start || matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    let off: ReturnType<typeof setTimeout> | undefined;
    const step = (now: number) => {
      const k = instant ? 1 : Math.min(1, (now - t0) / TWEEN_MS);
      setShown(Math.round(start + (value - start) * (1 - (1 - k) ** 3)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame((now) => {
      if (value > start) {
        setFlash(true);
        off = setTimeout(() => setFlash(false), FLASH_MS);
      }
      step(now);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(off);
    };
  }, [value]);

  return (
    <span title={value.toLocaleString("vi-VN")} className={`tabular-nums transition-colors duration-700 ${flash ? "text-jade" : ""} ${className}`}>
      {formatCount(shown)}
    </span>
  );
}
