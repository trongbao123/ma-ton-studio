import type { Metadata } from "next";
import { PublicPage } from "@/components/public-page";

export const metadata: Metadata = { title: "Chính sách bảo mật · Ma Tôn Studio" };

export default function PrivacyPage() {
  return (
    <PublicPage title="Chính sách bảo mật">
      <p>Cập nhật: tháng 11/2026. Áp dụng cho công cụ Ma Tôn Studio của kênh YouTube Ma Tôn Truyện.</p>
      <h2>Dữ liệu Google / YouTube mà công cụ dùng</h2>
      <ul>
        <li>Quyền tải video lên YouTube (youtube.upload) và quản lý video của chính kênh (youtube.force-ssl) để đăng video, đặt lịch công khai và ảnh thumbnail.</li>
        <li>Tên kênh, để hiển thị kênh đang kết nối.</li>
      </ul>
      <h2>Cách lưu trữ và bảo vệ</h2>
      <ul>
        <li>Mã truy cập (refresh token) được mã hoá AES-256-GCM trước khi lưu; khoá giải mã lưu tách riêng khỏi cơ sở dữ liệu.</li>
        <li>Dữ liệu chỉ dùng để đăng video lên kênh của chính chủ kênh. Không bán, không chia sẻ cho bên thứ ba, không dùng cho quảng cáo.</li>
        <li>Công cụ không đọc, không lưu dữ liệu của khán giả hay người dùng YouTube khác.</li>
      </ul>
      <h2>Thu hồi quyền và xoá dữ liệu</h2>
      <p>
        Chủ kênh có thể ngắt kết nối bất cứ lúc nào trong công cụ (mã truy cập bị xoá ngay), hoặc thu hồi quyền tại myaccount.google.com/permissions. Việc dùng dữ liệu
        từ Google API tuân theo Google API Services User Data Policy, kể cả các yêu cầu Limited Use.
      </p>

      <h2>Privacy policy (English)</h2>
      <ul>
        <li>
          Scopes used: youtube.upload and youtube.force-ssl, only to upload videos to the owner&apos;s own channel, schedule publishing and set thumbnails; the
          channel name is read to show which channel is connected.
        </li>
        <li>OAuth refresh tokens are encrypted with AES-256-GCM at rest; the encryption key is stored separately from the database.</li>
        <li>Data is used solely to publish the channel owner&apos;s videos. It is never sold, shared with third parties or used for advertising.</li>
        <li>No viewer or third-party YouTube user data is read or stored.</li>
        <li>
          The owner can disconnect at any time inside the tool (tokens are deleted immediately) or revoke access at myaccount.google.com/permissions. Use of data
          received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
        </li>
      </ul>
    </PublicPage>
  );
}
