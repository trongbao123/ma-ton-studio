import Link from "next/link";
import type { ReactNode } from "react";

/** Đường nội bộ ("/videos/5") đi qua next/link (prefetch, chuyển trang không tải lại); link ngoài mở tab mới. */
export function SmartLink({ href, className, children, onClick }: { href: string; className?: string; children: ReactNode; onClick?: (e: React.MouseEvent) => void }) {
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className} onClick={onClick}>
      {children}
    </a>
  );
}
