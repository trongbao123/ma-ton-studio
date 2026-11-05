import { NextResponse, type NextRequest } from "next/server";
import { isAuthorized } from "@/lib/auth";

export function proxy(request: NextRequest) {
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
