import { Bone, HeaderBones, RowBones } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-10">
      <HeaderBones />
      <Bone className="h-20 w-full rounded-2xl" />
      <RowBones count={5} />
    </div>
  );
}
