import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FlowStudio } from "@/components/flow/flow-studio";
import { getFlowLayout, loadFlowData } from "@/lib/flow/data";
import { parseId } from "@/lib/params";

export default function VideoFlowPage({ params }: PageProps<"/videos/[id]">) {
  return (
    // Phủ đúng vùng dưới header (h-12), thoát khỏi khung max-w của layout để canvas full màn hình.
    <div className="flow-dark fixed inset-x-0 bottom-0 top-12 z-10 bg-[#0d0d10] text-foreground">
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
