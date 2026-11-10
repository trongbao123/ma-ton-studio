/**
 * URL tải file của video qua /api/videos/[id]/[file]. `version` là id asset GitHub: render lại sinh asset mới nên URL đổi,
 * nhờ vậy route trả được Cache-Control "immutable" mà không sợ hiện ảnh cũ.
 */
export const assetUrl = (videoId: number, file: string, version: number | null | undefined) =>
  `/api/videos/${videoId}/${file}${version ? `?v=${version}` : ""}`;
