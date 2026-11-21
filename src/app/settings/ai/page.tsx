import { connection } from "next/server";
import { Suspense } from "react";
import { AiRoutingEditor } from "@/components/ai-routing-editor";
import { availableProviders, loadImageRouting, loadRouting } from "@/lib/ai";
import { secretStatus } from "@/lib/secrets";
import { loadCliStatus, withCliStatus } from "@/lib/ai/cli-status";
import { FacebookConnect } from "@/components/facebook-connect";
import { listFacebookPages } from "@/lib/facebook";

export default function AiSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cài đặt AI</h1>
        <p className="mt-1 text-sm text-muted">
          Mỗi việc dùng một danh sách AI theo thứ tự ưu tiên — AI đầu lỗi, hết lượt hoặc từ chối thì tự chuyển sang AI kế tiếp.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Đang tải…</p>}>
        <Editor />
      </Suspense>
    </div>
  );
}

async function Editor() {
  await connection();
  // Bốn truy vấn độc lập → một vòng song song (trước: secretStatus rồi mới tới ba cái còn lại).
  const [secrets, routing, images, cli] = await Promise.all([secretStatus(), loadRouting(true), loadImageRouting(), loadCliStatus()]);
  const pages = await listFacebookPages().catch(() => []);
  return (
    <>
      {/* Đặt TRƯỚC trình chỉnh AI: trình chỉnh có thanh "Lưu cài đặt" cố định ở đáy màn hình và chỉ chừa chỗ ở cuối chính nó. */}
      <FacebookConnect connected={pages} />
      <AiRoutingEditor initial={routing} initialImages={images} available={withCliStatus(availableProviders(), cli)} secrets={secrets} cli={cli} />
    </>
  );
}
