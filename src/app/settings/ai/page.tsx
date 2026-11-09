import { connection } from "next/server";
import { Suspense } from "react";
import { AiRoutingEditor } from "@/components/ai-routing-editor";
import { availableProviders, loadRouting } from "@/lib/ai";

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
  return <AiRoutingEditor initial={await loadRouting(true)} available={availableProviders()} />;
}
