import type { Metadata } from "next";
import { Be_Vietnam_Pro, Noto_Serif } from "next/font/google";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { TopStatus } from "@/components/top-status";
import "./globals.css";

const font = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Tên truyện dùng serif như bìa sách. Chỉ là tiêu đề → không preload (đỡ 4 file font chặn băng thông đầu trang), chữ dự phòng hiện trước rồi đổi (swap).
const serif = Noto_Serif({
  variable: "--font-noto-serif",
  subsets: ["vietnamese", "latin"],
  weight: ["600", "800"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "Ma Tôn Studio",
  description: "Xưởng viết truyện tự động cho kênh Thôn Phệ Audio",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${font.variable} ${serif.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <AppShell
          status={
            <Suspense fallback={null}>
              <TopStatus />
            </Suspense>
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
