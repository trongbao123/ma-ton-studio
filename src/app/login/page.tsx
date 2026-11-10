import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Đăng nhập · Ma Tôn Studio" };

/** Trang đăng nhập phủ toàn màn hình (che menu của app — khách chưa đăng nhập không cần thấy). */
export default function LoginPage() {
  const needUser = Boolean(process.env.ADMIN_USER);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      {/* Quầng chu sa mờ phía sau con dấu */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[18%] h-[520px] w-[520px] -translate-x-1/2 rounded-full opacity-40 blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(210,70,59,.35), rgba(212,168,75,.08) 55%, transparent 70%)" }}
      />
      <main className="relative mx-auto flex min-h-full max-w-sm flex-col justify-center px-6 py-16">
        <div className="mb-9 flex flex-col items-center text-center">
          <span className="grid h-16 w-16 place-items-center rounded-2xl bg-seal font-serif text-3xl font-black text-[#fbe9e4] shadow-[inset_0_0_0_2px_rgba(255,255,255,.12),0_10px_30px_rgba(210,70,59,.4)]">
            魔
          </span>
          <h1 className="mt-5 font-serif text-3xl font-extrabold tracking-tight">Ma Tôn Studio</h1>
          <p className="mt-1.5 text-sm text-muted">Xưởng truyện tự động của kênh Ma Tôn Truyện</p>
        </div>
        <Suspense fallback={<LoginForm needUser={needUser} next="/" />}>
          <LoginForm needUser={needUser} />
        </Suspense>
        <p className="mt-8 text-center text-xs text-muted/70">Ghi nhớ đăng nhập 30 ngày trên trình duyệt này.</p>
      </main>
    </div>
  );
}
