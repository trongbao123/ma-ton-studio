import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { canEncrypt, decrypt, encrypt } from "./crypto";
import { SECRET_KEYS, SECRETS_KEY, type SecretStatus } from "./secret-keys";

const NAMES = SECRET_KEYS.map((k) => k.env);
// Giá trị gốc từ môi trường (Vercel env / GitHub Secrets) — xoá key trên web thì quay về giá trị này.
const ORIGINAL: Record<string, string | undefined> = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));

let loadedAt = 0;
let stored: Record<string, string> = {};

function parseStored(raw: unknown): Record<string, string> {
  const v = (raw ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    NAMES.flatMap((n) => {
      if (typeof v[n] !== "string" || !v[n]) return [];
      try {
        return [[n, decrypt(v[n] as string)]];
      } catch {
        console.warn(`Không giải mã được ${n} — SECRETS_KEY sai hoặc thiếu.`);
        return [];
      }
    }),
  );
}

async function readStored(): Promise<Record<string, string>> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SECRETS_KEY));
  return parseStored(row?.value);
}

/** Bản đã mã hoá đang lưu trong DB (để ghi lại các key khác không phải giải mã/mã hoá lại). */
async function readRaw(): Promise<Record<string, string>> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SECRETS_KEY));
  return (row?.value ?? {}) as Record<string, string>;
}

/** Đưa key (đã giải mã) vào process.env — key trên web thắng key môi trường; xoá trên web thì quay về giá trị gốc. */
function applyToEnv() {
  for (const n of NAMES) {
    const v = stored[n] ?? ORIGINAL[n];
    if (v) process.env[n] = v;
    else delete process.env[n];
  }
}

/** Còn trong 60 giây nhớ của lần nạp trước. */
export const secretsFresh = () => Date.now() - loadedAt < 60_000;

/**
 * Nạp key từ bản ghi app_settings đã đọc sẵn (loader gộp nhiều khoá vào một truy vấn) — khỏi tốn thêm một vòng tới DB.
 * `raw` là giá trị của khoá SECRETS_KEY (undefined nếu chưa có).
 */
export function applySecrets(raw: unknown) {
  stored = parseStored(raw);
  loadedAt = Date.now();
  applyToEnv();
}

/**
 * Nạp key dán trên web (lưu trong DB) vào process.env — key trên web thắng key môi trường.
 * Vercel và GitHub Actions dùng chung DB nên dán một lần là cả hai nơi chạy được, không cần deploy lại.
 * Nhớ 60 giây; lỗi DB thì giữ nguyên môi trường.
 */
export async function loadSecrets(force = false) {
  if (!process.env.DATABASE_URL) return;
  if (!force && secretsFresh()) return;
  try {
    stored = await readStored();
    loadedAt = Date.now();
  } catch (e) {
    console.warn("Không đọc được key lưu trên web:", e instanceof Error ? e.message : e);
    return;
  }
  applyToEnv();
}

export async function secretStatus(): Promise<SecretStatus[]> {
  await loadSecrets(true);
  return NAMES.map((env) => {
    const source = stored[env] ? "web" : ORIGINAL[env] ? "env" : null;
    const v = stored[env] ?? ORIGINAL[env];
    return { env, source, hint: v ? `…${v.slice(-4)}` : null };
  });
}

/** Lưu hoặc xoá (value null) một key trên web. */
export async function saveSecret(env: string, value: string | null) {
  if (!NAMES.includes(env)) throw new Error("Key không hợp lệ.");
  if (value && !canEncrypt()) throw new Error("Máy chủ chưa có SECRETS_KEY nên chưa lưu key được (key luôn được mã hoá trước khi vào DB).");
  const next = { ...(await readRaw()) };
  if (value) next[env] = encrypt(value);
  else delete next[env];
  await db()
    .insert(appSettings)
    .values({ key: SECRETS_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  await loadSecrets(true);
}
