import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "@/lib/auth";

// Trang công khai Google bắt buộc để duyệt OAuth (trang chủ + chính sách bảo mật) — không chứa dữ liệu.
const PUBLIC = new Set(["/about", "/privacy"]);

export function proxy(request: NextRequest) {
  if (PUBLIC.has(request.nextUrl.pathname)) return NextResponse.next();
  if (isAuthorized(request.headers.get("authorization"), process.env.ADMIN_PASSWORD, process.env.ADMIN_USER)) {
    return NextResponse.next();
  }
  return new NextResponse("Cần đăng nhập", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Ma Ton Studio", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
