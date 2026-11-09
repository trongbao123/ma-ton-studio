import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FlowStudio } from "@/components/flow/flow-studio";
import { getFlowLayout, loadFlowData } from "@/lib/flow/data";
import { parseId } from "@/lib/params";

export default function VideoFlowPage({ params }: PageProps<"/videos/[id]">) {
  return (
    // Phủ toàn màn hình (che cả menu site) — màn flow có thanh trên riêng, giống app n8n.
    <div className="flow-dark fixed inset-0 z-30 bg-[#0d0d10] text-foreground">
      <Suspense fallback={<p className="p-6 text-muted">Đang tải flow…</p>}>
        <VideoFlow params={params} />
      </Suspense>
    </div>
  );
}

async function VideoFlow({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = parseId((await params).id);
  const [data, layout] = await Promise.all([loadFlowData(id), getFlowLayout()]);
  if (!data) notFound();
  return <FlowStudio data={data} layout={layout} />;
}
