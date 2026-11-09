import { loadFlowData } from "@/lib/flow/data";

/** Dữ liệu màn flow dạng JSON — client hỏi 2 giây/lần khi video đang chạy để xem tiến độ gần như realtime. */
export async function GET(_: Request, ctx: RouteContext<"/api/flow/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return new Response("Sai id", { status: 400 });
  const data = await loadFlowData(id);
  if (!data) return new Response("Không có video", { status: 404 });
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}
