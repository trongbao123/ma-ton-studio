import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
/** Link ký sẵn của GitHub hết hạn sau ~5 phút → chỉ cache chuyển hướng ngắn hơn thế. */
const REDIRECT_CACHE = "private, max-age=240";
const IMMUTABLE_CACHE = "private, max-age=31536000, immutable";

/**
 * Tải file từ GitHub Release (repo private).
 * - Ảnh (thumbnail, ảnh cảnh): nhỏ nên stream qua đây để trình duyệt cache lâu dài (immutable) — an toàn vì URL mang `?v=<id asset>`, render lại thì URL đổi.
 * - Video / audio: lớn nên lấy link ký sẵn của GitHub rồi chuyển hướng, không stream qua Vercel.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/videos/[id]/[file]">) {
  const { id, file } = await ctx.params;
  const [v] = await db().select({ assets: videos.assets }).from(videos).where(eq(videos.id, Number(id)));
  const assetId = v?.assets[file];
  if (!assetId) return new Response("Không có file", { status: 404 });

  const assetUrl = `https://api.github.com/repos/${process.env.GH_REPO}/releases/assets/${assetId}`;
  const headers = { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/octet-stream" };
  const imageType = IMAGE_TYPES[file.split(".").pop()?.toLowerCase() ?? ""];

  if (imageType) {
    const res = await fetch(assetUrl, { headers });
    if (!res.ok || !res.body) return new Response(`GitHub trả ${res.status}`, { status: 502 });
    const versioned = new URL(request.url).searchParams.get("v") === String(assetId);
    return new Response(res.body, { headers: { "Content-Type": imageType, "Cache-Control": versioned ? IMMUTABLE_CACHE : "private, max-age=60" } });
  }

  const res = await fetch(assetUrl, { headers, redirect: "manual" });
  const location = res.headers.get("location");
  if (!location) return new Response(`GitHub trả ${res.status}`, { status: 502 });
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": REDIRECT_CACHE } });
}
