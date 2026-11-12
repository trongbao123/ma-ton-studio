import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Giới thiệu · Ma Tôn Studio" };

export default function AboutPage() {
  return (
    <PublicPage title="Giới thiệu">
      <p>
        Ma Tôn Studio là công cụ nội bộ của kênh YouTube <b>Thôn Phệ Audio</b>. Công cụ giúp chủ kênh viết truyện tiên hiệp, dựng video truyện audio (giọng đọc,
        hình minh hoạ, phụ đề) và đăng video lên chính kênh YouTube của mình theo lịch.
      </p>
      <p>Công cụ chỉ dành cho chủ kênh sử dụng, không cung cấp cho người dùng khác và không thu thập dữ liệu của khán giả.</p>
      <h2>About (English)</h2>
      <p>
        Ma Tôn Studio is a private production tool for the YouTube channel <b>Thôn Phệ Audio</b>. It helps the channel owner write xianxia stories, produce audio-story
        videos (narration, illustrations, subtitles) and upload them to the owner&apos;s own YouTube channel on a schedule. It is used only by the channel owner.
      </p>
    </PublicPage>
  );
}
