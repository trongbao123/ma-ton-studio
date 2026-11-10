import { FlowSkeleton } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="flow-dark fixed inset-0 z-30 bg-[#0d0d10] text-foreground">
      <FlowSkeleton />
    </div>
  );
}
