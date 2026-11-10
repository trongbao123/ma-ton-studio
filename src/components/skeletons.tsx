/** Khối xám nhấp nháy dùng cho loading.tsx — hiện ngay khi bấm chuyển trang, trước khi dữ liệu về. */
export function Bone({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-white/[.06] ${className}`} />;
}

/** Tiêu đề trang + dòng mô tả. */
export function HeaderBones({ withLine = true }: { withLine?: boolean }) {
  return (
    <header className="space-y-3">
      <Bone className="h-9 w-56 sm:h-10" />
      {withLine && <Bone className="h-4 w-80 max-w-full" />}
    </header>
  );
}

/** Lưới thẻ (bìa truyện / video). */
export function TileGridBones({ count = 8, ratio = "aspect-video", cols = "sm:grid-cols-2 xl:grid-cols-4" }: { count?: number; ratio?: string; cols?: string }) {
  return (
    <ul className={`grid gap-x-5 gap-y-8 ${cols}`} aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="space-y-3">
          <Bone className={`${ratio} w-full rounded-xl`} />
          <Bone className="h-4 w-3/4" />
          <Bone className="h-3 w-1/2" />
        </li>
      ))}
    </ul>
  );
}

/** Các hàng danh sách (hạn mức, chương…). */
export function RowBones({ count = 6 }: { count?: number }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-busy>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Bone className="h-9 w-9 shrink-0" />
          <div className="flex-1 space-y-2">
            <Bone className="h-4 w-1/3" />
            <Bone className="h-3 w-2/3" />
          </div>
          <Bone className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Khung màn flow: thanh trên + cây thẻ + bảng chi tiết. Cũng dùng làm fallback khi nạp canvas. */
export function FlowSkeleton() {
  const card = <Bone className="h-[68px] w-[200px] rounded-2xl" />;
  return (
    <div className="flex h-full flex-col" aria-busy>
      <div className="flex items-center gap-3 border-b border-border bg-[#111115] px-5 py-3">
        <Bone className="h-9 w-9 rounded-xl" />
        <div className="space-y-2">
          <Bone className="h-3 w-52" />
          <Bone className="h-5 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_450px]">
        <div className="relative flex flex-col items-center justify-center gap-5 overflow-hidden bg-[#0f0f13] py-6">
          {card}
          {card}
          {card}
          <div className="flex gap-6">
            {card}
            {card}
            {card}
          </div>
          {card}
        </div>
        <div className="hidden space-y-4 border-l border-border bg-[#141418] p-6 lg:block">
          <div className="flex items-center gap-3">
            <Bone className="h-11 w-11 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Bone className="h-5 w-40" />
              <Bone className="h-3 w-56" />
            </div>
          </div>
          <Bone className="h-9 w-full" />
          <Bone className="h-40 w-full" />
          <Bone className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
