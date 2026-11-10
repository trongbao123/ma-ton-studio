import { Bone, HeaderBones, TileGridBones } from "@/components/skeletons";

export default function Loading() {
  return (
    <div className="space-y-8">
      <HeaderBones withLine={false} />
      <div className="flex gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Bone key={i} className="h-9 w-20 rounded-full" />
        ))}
      </div>
      <TileGridBones count={8} />
    </div>
  );
}
