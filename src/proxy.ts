import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

// Trang công khai: Google bắt buộc để duyệt OAuth (trang chủ + chính sách bảo mật) và trang đăng nhập — không chứa dữ liệu.
// Webhook YouTube (WebSub): hub của Google gọi không đăng nhập — route tự kiểm chữ ký HMAC.
const PUBLIC = new Set(["/about", "/privacy", "/login", "/api/youtube/websub"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.has(pathname)) return NextResponse.next();
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER;
  // Cookie phiên (trang đăng nhập) hoặc Basic Auth cũ (vẫn nhận để link/công cụ cũ không gãy).
  if (
    (await verifySession(request.cookies.get(SESSION_COOKIE)?.value, password, user)) ||
    isAuthorized(request.headers.get("authorization"), password, user)
  ) {
    return NextResponse.next();
  }
  // Trang thường → chuyển sang /login rồi quay lại đúng chỗ; API / Server Action → 401.
  if (request.method === "GET" && !pathname.startsWith("/api/")) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
