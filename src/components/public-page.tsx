import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Khung trang công khai (giới thiệu, chính sách bảo mật): phủ toàn màn hình, che menu của app —
 * khách ngoài không thấy và không cần các mục cần đăng nhập.
 */
export function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <div className="mb-10 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-seal font-serif text-xl font-black text-[#fbe9e4]">魔</span>
          <span className="font-serif text-lg font-extrabold">Ma Tôn Studio</span>
        </div>
        <h1 className="mb-8 font-serif text-3xl font-extrabold">{title}</h1>
        <div className="space-y-5 leading-relaxed text-foreground/90 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
        <p className="mt-14 border-t border-border pt-6 text-sm text-muted">
          <Link href="/about" className="hover:text-foreground">
            Giới thiệu
          </Link>
          <span className="mx-3">·</span>
          <Link href="/privacy" className="hover:text-foreground">
            Chính sách bảo mật / Privacy policy
          </Link>
        </p>
      </div>
    </div>
  );
}
