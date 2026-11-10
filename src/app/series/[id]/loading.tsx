import { Bone, RowBones } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Bone className="h-8 w-64" />
        <Bone className="h-4 w-24" />
      </div>
      <Bone className="h-48 w-full rounded-2xl" />
      <RowBones count={6} />
    </div>
  );
}
