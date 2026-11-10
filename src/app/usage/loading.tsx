import { HeaderBones, RowBones } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-12">
      <HeaderBones />
      <RowBones count={7} />
      <RowBones count={4} />
    </div>
  );
}
