import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";

/** Tải file từ GitHub Release (repo private): lấy link ký sẵn của GitHub rồi chuyển hướng, không stream qua Vercel. */
export async function GET(_: Request, ctx: RouteContext<"/api/videos/[id]/[file]">) {
  const { id, file } = await ctx.params;
  const [v] = await db().select({ assets: videos.assets }).from(videos).where(eq(videos.id, Number(id)));
  const assetId = v?.assets[file];
  if (!assetId) return new Response("Không có file", { status: 404 });

  const res = await fetch(`https://api.github.com/repos/${process.env.GH_REPO}/releases/assets/${assetId}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/octet-stream" },
    redirect: "manual",
  });
  const location = res.headers.get("location");
  if (!location) return new Response(`GitHub trả ${res.status}`, { status: 502 });
  return Response.redirect(location, 302);
}
