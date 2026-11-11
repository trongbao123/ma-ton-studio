// Vercel Cron gọi vào đây để kích hoạt lượt daily ĐÚNG GIỜ.
//
// `schedule` của GitHub Actions bị đẩy lùi 2–12 tiếng (đo 14 lượt gần nhất, trung vị 6,5 giờ) nên lượt
// "8h17 sáng" thực tế chạy lúc ~14h47 — trễ lịch đăng 15h, chương dồn lại, lượt sau đụng trần 240 phút rồi bị huỷ.
// `workflow_dispatch` qua API chạy ngay, không qua hàng đợi ưu tiên thấp đó.
//
// Cron trong GitHub vẫn giữ làm lưới an toàn: nếu Vercel Cron hỏng thì muộn còn hơn không. Chạy trùng cũng rẻ —
// daily tự kiểm tồn kho rồi thoát sớm nếu không có việc.
import { cronAuth, dispatchUrl } from "@/lib/cron-auth";

export async function GET(req: Request) {
  const why = cronAuth(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (why !== "ok") {
    // 503 khi chưa đặt secret: đó là lỗi cấu hình của mình, không phải người gọi sai.
    return Response.json({ error: why }, { status: why === "chua-dat-secret" ? 503 : 401 });
  }
  const url = dispatchUrl(process.env.GITHUB_REPOSITORY ?? process.env.GH_REPO, "daily.yml");
  const token = process.env.GH_TOKEN;
  if (!url || !token) return Response.json({ error: "thiếu GH_TOKEN hoặc GITHUB_REPOSITORY" }, { status: 503 });

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main" }),
    signal: AbortSignal.timeout(20_000),
  });
  // GitHub trả 204 khi nhận lệnh.
  if (!res.ok) return Response.json({ error: `GitHub ${res.status}`, detail: (await res.text()).slice(0, 300) }, { status: 502 });
  return Response.json({ ok: true, at: new Date().toISOString() });
}
