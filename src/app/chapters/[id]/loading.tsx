import { Bone } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Bone className="h-4 w-40" />
        <Bone className="h-8 w-96 max-w-full" />
        <Bone className="h-4 w-32" />
      </div>
      <Bone className="h-12 w-full" />
      <Bone className="h-[420px] w-full rounded-2xl" />
    </div>
  );
}
