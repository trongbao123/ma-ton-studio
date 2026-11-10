import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { FlowSkeleton } from "@/components/skeletons";
import { FlowStudio } from "@/components/flow/flow-studio";
import { loadFlowPage } from "@/lib/flow/data";
import { parseId } from "@/lib/params";

export default function VideoFlowPage({ params }: PageProps<"/videos/[id]">) {
  return (
    // Phủ toàn màn hình (che cả menu site) — màn flow có thanh trên riêng, giống app n8n.
    <div className="flow-dark fixed inset-0 z-30 bg-[#0d0d10] text-foreground">
      <Suspense fallback={<FlowSkeleton />}>
        <VideoFlow params={params} />
      </Suspense>
    </div>
  );
}

async function VideoFlow({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const id = parseId((await params).id);
  const page = await loadFlowPage(id);
  if (!page) notFound();
  return <FlowStudio data={page.data} layout={page.layout} layoutH={page.layoutH} />;
}
