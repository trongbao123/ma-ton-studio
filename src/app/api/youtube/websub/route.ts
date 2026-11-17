import { after, type NextRequest } from "next/server";
import { loadSecrets } from "@/lib/secrets";
import { markVerified, parseFeedChannelId, parseFeedVideoIds, readAllWebsubStates, verifySignature, websubSecret } from "@/lib/websub";
import { syncFromYoutube } from "@/lib/youtube-stats";

// Webhook YouTube (WebSub). Công khai (proxy cho qua) vì hub của Google gọi không có đăng nhập:
// GET = hub xác nhận đăng ký (trả lại hub.challenge), POST = tin video mới / đổi tiêu đề–mô tả (có chữ ký HMAC).

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const mode = q.get("hub.mode");
  const topic = q.get("hub.topic") ?? "";
  const challenge = q.get("hub.challenge");
  if (mode === "denied") return new Response("ok");
  if (!challenge || (mode !== "subscribe" && mode !== "unsubscribe")) return new Response("bad request", { status: 400 });
  // Chỉ nhận đăng ký do chính app yêu cầu (đúng topic đã lưu); huỷ đăng ký lạ thì từ chối.
  if (mode === "unsubscribe") return new Response("not found", { status: 404 });
  const lease = Number(q.get("hub.lease_seconds"));
  if (!(await markVerified(topic, Number.isFinite(lease) && lease > 0 ? lease : null))) return new Response("not found", { status: 404 });
  return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  // Sai chữ ký / kênh lạ: vẫn trả 2xx (đúng chuẩn WebSub, để hub không gửi lại) nhưng bỏ qua.
  if (!verifySignature(body, request.headers.get("x-hub-signature"), websubSecret())) return new Response(null, { status: 202 });
  const states = await readAllWebsubStates();
  const channel = parseFeedChannelId(body);
  if (!states.length || (channel && !states.some((x) => x.state.channelId === channel))) return new Response(null, { status: 202 });
  const ids = parseFeedVideoIds(body);
  if (ids.length) {
    // Trả lời hub ngay, kéo bản mới từ YouTube sau (1 quota unit).
    after(async () => {
      await loadSecrets();
      const n = await syncFromYoutube(ids);
      console.log(`WebSub: ${ids.join(", ")} → cập nhật ${n} video`);
    });
  }
  return new Response(null, { status: 204 });
}
