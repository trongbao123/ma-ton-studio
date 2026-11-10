/**
 * Phiên đăng nhập bằng cookie (thay hộp thoại Basic Auth của trình duyệt).
 * Token = `<hết hạn ms>.<HMAC-SHA256>`, khoá suy từ ADMIN_USER + ADMIN_PASSWORD → đổi mật khẩu là mọi phiên cũ hết hiệu lực.
 * Dùng Web Crypto để chạy được ở cả proxy lẫn Server Action.
 */
export const SESSION_COOKIE = "mt_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function sign(payload: string, password: string, user = "") {
  const key = await crypto.subtle.importKey("raw", enc.encode(`ma-ton-studio:${user}:${password}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(password: string, user?: string, now = Date.now()) {
  const exp = String(now + SESSION_DAYS * 86_400_000);
  return `${exp}.${await sign(exp, password, user)}`;
}

export async function verifySession(token: string | undefined, password: string | undefined, user?: string, now = Date.now()) {
  if (!token || !password) return false;
  const [exp, mac] = token.split(".");
  if (!exp || !mac || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return safeEqual(mac, await sign(exp, password, user));
}

/** So sánh không lộ thời gian (đúng/sai bao nhiêu ký tự). */
export function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
