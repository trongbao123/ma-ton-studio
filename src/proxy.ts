import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "@/lib/auth";
import { PUBLIC_PATHS } from "@/lib/public-routes";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Danh sách + lý do từng đường dẫn nằm ở public-routes.ts; mỗi route ở đó tự kiểm quyền bên trong.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
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
