// Kiểm quyền cho route hẹn giờ (Vercel Cron) — phần thuần, để test được.
//
// Vì sao cần route này: `schedule` của GitHub Actions bị đẩy lùi 2–12 tiếng (đo 14 lượt, trung vị 6,5 giờ),
// nên lượt "8h17 sáng" thực tế chạy lúc ~14h47 và trễ lịch đăng 15h. `workflow_dispatch` qua API chạy NGAY,
// nên Vercel Cron gọi vào đây rồi dispatch sang GitHub.

/** Lý do từ chối, hoặc "ok". Không có secret thì TỪ CHỐI — để ngỏ nghĩa là ai cũng kích hoạt được lượt daily. */
export function cronAuth(authHeader: string | null, secret: string | undefined): "ok" | "chua-dat-secret" | "sai-token" {
  if (!secret) return "chua-dat-secret";
  return authHeader === `Bearer ${secret}` ? "ok" : "sai-token";
}

/** URL dispatch của một workflow. Repo phải đúng dạng `chu-so-huu/ten-repo`, không thì null. */
export function dispatchUrl(repo: string | undefined, workflow: string): string | null {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
}
