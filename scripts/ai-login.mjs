#!/usr/bin/env node
// Đăng nhập gói Pro/Plus (Claude, ChatGPT, Gemini) trên máy bạn rồi copy thông tin đăng nhập vào clipboard
// để dán vào Cài đặt AI trên web (web mã hoá AES-256-GCM trước khi lưu). Không in token ra màn hình.
//
//   node scripts/ai-login.mjs claude   → Claude Pro/Max  (token dùng ~1 năm)
//   node scripts/ai-login.mjs codex    → ChatGPT Plus/Pro
//   node scripts/ai-login.mjs gemini   → Gemini (tài khoản Google / gói Google AI)
//
// Phiên bản CLI khớp với workflow GitHub Actions.
import { spawn, spawnSync } from "node:child_process";
import { createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSIONS = { claude: "@anthropic-ai/claude-code@2.1.311", codex: "@openai/codex@0.164.0", gemini: "@google/gemini-cli@0.65.0" };
const kind = process.argv[2];
if (!VERSIONS[kind]) {
  console.log("Dùng: node scripts/ai-login.mjs claude | codex | gemini");
  process.exit(1);
}

const win = process.platform === "win32";
const npx = (args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(win ? "npx.cmd" : "npx", ["-y", VERSIONS[kind], ...args], { stdio: "inherit", env: { ...process.env, ...env }, shell: win });
    child.on("close", resolve);
  });

function copy(text) {
  const cmd = win ? ["clip"] : process.platform === "darwin" ? ["pbcopy"] : ["xclip", "-selection", "clipboard"];
  const r = spawnSync(cmd[0], cmd.slice(1), { input: text });
  return r.status === 0;
}

function done(text, label) {
  if (copy(text)) console.log(`\n✅ Đã copy ${label} vào clipboard. Mở web → Cài đặt AI → ô "${label}" → dán (Ctrl+V) → Lưu.`);
  else {
    const file = path.join(os.tmpdir(), `ai-login-${kind}.json`);
    writeFileSync(file, text, { mode: 0o600 });
    console.log(`\n⚠ Không copy được vào clipboard. Mở ${file}, copy toàn bộ rồi dán vào ô "${label}" trên web, xong thì xoá file đó.`);
  }
}

if (kind === "claude") {
  // Lệnh chính thức của Anthropic cho máy chủ/CI: mở trình duyệt đăng nhập, in token sk-ant-oat… ở cuối.
  console.log("Trình duyệt sẽ mở để đăng nhập Claude. Xong, copy dòng token bắt đầu bằng sk-ant-oat… rồi dán vào ô \"Claude — gói Pro\" trên web.\n");
  await npx(["setup-token"]);
  process.exit(0);
}

if (kind === "codex") {
  const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const file = path.join(home, "auth.json");
  if (!existsSync(file) || process.argv.includes("--login")) {
    console.log("Trình duyệt sẽ mở để đăng nhập ChatGPT (chọn Sign in with ChatGPT).\n");
    await npx(["login", "-c", 'cli_auth_credentials_store="file"']);
  }
  if (!existsSync(file)) {
    console.log(`\n❌ Không thấy ${file} — đăng nhập chưa xong, chạy lại.`);
    process.exit(1);
  }
  const auth = JSON.parse(readFileSync(file, "utf8"));
  if (!auth.tokens?.refresh_token) {
    console.log("\n❌ auth.json không có token ChatGPT (có thể đang đăng nhập bằng API key). Chạy lại với --login và chọn Sign in with ChatGPT.");
    process.exit(1);
  }
  done(JSON.stringify(auth), "ChatGPT — gói Plus");
  process.exit(0);
}

// Gemini: CLI cất token trong kho mật khẩu hệ điều hành. Ép lưu ra file mã hoá (khoá theo tên máy + user)
// để script này giải mã được, rồi đổi sang dạng oauth_creds.json mà CLI trên GitHub Actions đọc.
const dir = path.join(process.env.GEMINI_CLI_HOME ?? os.homedir(), ".gemini");
const store = path.join(dir, "gemini-credentials.json");
const legacy = path.join(dir, "oauth_creds.json");

function readCreds() {
  if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf8"));
  if (!existsSync(store)) return null;
  const key = scryptSync("gemini-cli-oauth", `${os.hostname()}-${os.userInfo().username}-gemini-cli`, 32);
  const [iv, tag, data] = readFileSync(store, "utf8").trim().split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"), { authTagLength: 16 });
  d.setAuthTag(Buffer.from(tag, "hex"));
  const all = JSON.parse(d.update(data, "hex", "utf8") + d.final("utf8"));
  const raw = all["gemini-cli-oauth"]?.["main-account"];
  if (!raw) return null;
  const t = JSON.parse(raw).token ?? {};
  return { access_token: t.accessToken, refresh_token: t.refreshToken, token_type: t.tokenType ?? "Bearer", scope: t.scope, expiry_date: t.expiresAt };
}

let creds = process.argv.includes("--login") ? null : readCreds();
if (!creds?.refresh_token) {
  console.log("Gemini CLI sẽ mở. Chọn \"Sign in with Google\" (đăng nhập tài khoản có gói), đợi vào được màn chat rồi gõ /quit để thoát.\n");
  await npx([], { GEMINI_FORCE_FILE_STORAGE: "true", GEMINI_DEFAULT_AUTH_TYPE: "oauth-personal" });
  creds = readCreds();
}
if (!creds?.refresh_token) {
  console.log("\n❌ Chưa lấy được token Gemini — đăng nhập chưa xong. Chạy lại: node scripts/ai-login.mjs gemini --login");
  process.exit(1);
}
done(JSON.stringify(creds), "Gemini — gói Google");
