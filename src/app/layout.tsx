import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const font = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["vietnamese", "latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Ma Tôn Studio",
  description: "Xưởng viết truyện tự động cho kênh Ma Tôn Truyện",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className={`${font.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <header className="h-12 border-b border-border">
          <nav className="mx-auto flex h-full max-w-5xl items-center gap-4 overflow-x-auto whitespace-nowrap px-4 sm:gap-6">
            <Link href="/" className="font-bold text-accent">
              Ma Tôn Studio
            </Link>
            <Link href="/" className="text-sm text-muted hover:text-foreground">
              Truyện
            </Link>
            <Link href="/videos" className="text-sm text-muted hover:text-foreground">
              Video
            </Link>
            <Link href="/series/new" className="text-sm text-muted hover:text-foreground">
              + Truyện mới
            </Link>
            <Link href="/settings/ai" className="text-sm text-muted hover:text-foreground">
              Cài đặt AI
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
