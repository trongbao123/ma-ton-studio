/**
 * Kiểm tra header Basic Auth. Web chỉ có một người dùng nên dùng mật khẩu chung trong env,
 * đủ để người lạ không đốt quota API.
 */
export function isAuthorized(header: string | null, password: string | undefined): boolean {
  if (!password) return false;
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice("Basic ".length)), (c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
  const supplied = decoded.slice(decoded.indexOf(":") + 1);
  return timingSafeEqual(supplied, password);
}

function timingSafeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
