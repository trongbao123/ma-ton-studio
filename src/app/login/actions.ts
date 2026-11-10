"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSession, safeEqual, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

export type LoginState = { error?: string };

/** Chỉ cho quay về đường dẫn nội bộ (chống chuyển hướng sang trang lạ). */
const safeNext = (v: FormDataEntryValue | null) => {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
};

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const password = process.env.ADMIN_PASSWORD;
  const user = process.env.ADMIN_USER;
  if (!password) return { error: "Máy chủ chưa đặt ADMIN_PASSWORD." };
  const okUser = !user || safeEqual(String(form.get("user") ?? "").trim(), user);
  const okPass = safeEqual(String(form.get("password") ?? ""), password);
  if (!okUser || !okPass) {
    // Chậm lại một nhịp để dò mật khẩu tốn thời gian.
    await new Promise((r) => setTimeout(r, 600));
    return { error: user ? "Sai tài khoản hoặc mật khẩu." : "Sai mật khẩu." };
  }
  (await cookies()).set(SESSION_COOKIE, await createSession(password, user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  redirect(safeNext(form.get("next")));
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
