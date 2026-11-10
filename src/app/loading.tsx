import { Bone, HeaderBones, TileGridBones } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-14">
      <div className="space-y-3">
        <HeaderBones withLine={false} />
        <Bone className="h-4 w-96 max-w-full" />
      </div>
      <TileGridBones count={4} ratio="aspect-[4/5]" cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-4" />
      <TileGridBones count={4} />
    </div>
  );
}
