"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useLive } from "@/lib/live/store";

/**
 * Trang danh sách tự làm mới khi đồng bộ YouTube vừa đổi DB (tiêu đề, thumbnail, lịch đăng — sửa tay trong Studio):
 * luồng SSE báo `stats.metaAt` mới hơn lúc tải trang → router.refresh() (chỉ tải lại dữ liệu, không nháy trang).
 */
export function LiveRefresh({ initial }: { initial: number | null | undefined }) {
  const { stats } = useLive();
  const router = useRouter();
  const seen = useRef(initial ?? 0);
  const at = stats?.metaAt ?? 0;
  useEffect(() => {
    if (at > seen.current) {
      seen.current = at;
      router.refresh();
    }
  }, [at, router]);
  return null;
}
