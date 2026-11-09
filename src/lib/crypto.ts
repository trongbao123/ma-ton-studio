import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Mã hoá key/token trước khi lưu DB (AES-256-GCM). Khoá chính `SECRETS_KEY` nằm ngoài DB
 * (Vercel env + GitHub Secrets) — lộ DB hay bản backup cũng không đọc được key.
 */
const PREFIX = "enc:v1:";

function masterKey() {
  const raw = process.env.SECRETS_KEY;
  if (!raw) throw new Error("Thiếu SECRETS_KEY — không mã hoá/giải mã được key lưu trên web.");
  return createHash("sha256").update(raw).digest();
}

export const canEncrypt = () => Boolean(process.env.SECRETS_KEY);

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

/** Giải mã; giá trị cũ chưa mã hoá (không có tiền tố) trả nguyên để không hỏng dữ liệu đã lưu trước đây. */
export function decrypt(stored: string) {
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, data] = stored.slice(PREFIX.length).split(":").map((x) => Buffer.from(x, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
