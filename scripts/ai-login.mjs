#!/usr/bin/env node
// Kết nối gói Claude Pro / ChatGPT Plus / Gemini cho job GitHub Actions — một lệnh, không copy/dán:
//   node scripts/ai-login.mjs            → Claude + ChatGPT (bỏ qua gói nào lỗi)
//   node scripts/ai-login.mjs gemini claude → chỉ các gói chỉ định (claude | codex | gemini)
// Mỗi gói: mở trình duyệt để bạn bấm "Cho phép" → lấy thông tin đăng nhập → lưu thẳng vào GitHub Secrets
// (gh secret set, mã hoá phía GitHub; không in token ra màn hình) → chạy workflow ai-check gọi thử và báo kết quả.
// Cần: Node, GitHub CLI (gh) đã đăng nhập. Phiên bản CLI khớp với workflow.
import { spawn, spawnSync } from "node:child_process";
import { createDecipheriv, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const REPO = "trongbao123/ma-ton-studio";
const PKG = { claude: "@anthropic-ai/claude-code@2.1.311", codex: "@openai/codex@0.164.0", gemini: "@google/gemini-cli@0.65.0" };
const SECRET = { claude: "CLAUDE_CODE_OAUTH_TOKEN", codex: "CODEX_AUTH_JSON", gemini: "GEMINI_OAUTH_CREDS" };
const NAME = { claude: "Claude Pro", codex: "ChatGPT Plus", gemini: "Gemini" };
const win = process.platform === "win32";
const picked = process.argv.slice(2).filter((a) => PKG[a]);
// Gemini CLI: Google đã ngừng cho tài khoản cá nhân (IneligibleTierError UNSUPPORTED_CLIENT) → mặc định chỉ Claude + ChatGPT.
const kinds = picked.length ? picked : ["codex", "claude"];

// Không để key API trong môi trường: CLI sẽ dùng key (tốn tiền) thay vì đăng nhập gói.
const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) delete env[k];
  return env;
};

// Mở trang đăng nhập bằng Chrome (máy đặt Edge mặc định thì CLI vẫn mở thêm tab Edge — đóng tab đó là được).
const CHROME = [
  path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
].find((p) => existsSync(p));
const AUTH_HOST = /^https:\/\/(auth\.openai\.com|accounts\.google\.com|claude\.ai|console\.anthropic\.com|platform\.claude\.com)\//;
const opened = new Set();

/** Tìm URL đăng nhập trong output (bỏ mã màu; nối lại nếu bị xuống dòng giữa chừng) và mở bằng Chrome. */
function openAuthUrls(text) {
  if (!CHROME) return;
  const lines = text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/https:\/\/\S+/);
    if (!m) continue;
    let url = m[0];
    for (let j = i + 1; j < lines.length && /^\s*\S+\s*$/.test(lines[j]) && !/^\s*https?:/.test(lines[j]); j++) url += lines[j].trim();
    if (!AUTH_HOST.test(url) || opened.has(url) || !/[?&](state|code_challenge|client_id)=/.test(url)) continue;
    opened.add(url);
    spawn(CHROME, [url], { detached: true, stdio: "ignore" }).unref();
  }
}

function npx(kind, args, { env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(win ? "npx.cmd" : "npx", ["-y", PKG[kind], ...args], {
      stdio: ["inherit", "pipe", "inherit"],
      env: cleanEnv(env),
      shell: win,
    });
    let out = "";
    let timer;
    child.stdout.on("data", (d) => {
      process.stdout.write(d);
      out += d;
      // URL có thể in thành nhiều đợt — đợi chút cho đủ rồi mới mở.
      clearTimeout(timer);
      timer = setTimeout(() => openAuthUrls(out), 700);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

function saveSecret(kind, value) {
  const r = spawnSync("gh", ["secret", "set", SECRET[kind], "--repo", REPO], { input: value, encoding: "utf8", shell: win });
  if (r.status !== 0) throw new Error(`gh secret set lỗi: ${(r.stderr || r.stdout).trim()}`);
}

const step = (t) => console.log(`\n━━━ ${t} ━━━`);

// ── Lấy thông tin đăng nhập từng gói

async function codex() {
  const file = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "auth.json");
  const has = () => existsSync(file) && JSON.parse(readFileSync(file, "utf8")).tokens?.refresh_token;
  if (!has()) {
    console.log("Trình duyệt sẽ mở → đăng nhập ChatGPT (tài khoản có gói Plus) → bấm Continue/Allow.");
    await npx("codex", ["login", "-c", "cli_auth_credentials_store=file"]);
  }
  if (!has()) throw new Error("chưa đăng nhập xong ChatGPT.");
  return readFileSync(file, "utf8");
}

function geminiCreds() {
  const dir = path.join(process.env.GEMINI_CLI_HOME ?? os.homedir(), ".gemini");
  const legacy = path.join(dir, "oauth_creds.json");
  if (existsSync(legacy)) return JSON.parse(readFileSync(legacy, "utf8"));
  const store = path.join(dir, "gemini-credentials.json");
  if (!existsSync(store)) return null;
  // File mã hoá của Gemini CLI: khoá suy từ tên máy + user (chỉ giải được trên chính máy này).
  const key = scryptSync("gemini-cli-oauth", `${os.hostname()}-${os.userInfo().username}-gemini-cli`, 32);
  const [iv, tag, data] = readFileSync(store, "utf8").trim().split(":");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"), { authTagLength: 16 });
  d.setAuthTag(Buffer.from(tag, "hex"));
  const raw = JSON.parse(d.update(data, "hex", "utf8") + d.final("utf8"))["gemini-cli-oauth"]?.["main-account"];
  if (!raw) return null;
  const t = JSON.parse(raw).token ?? {};
  return { access_token: t.accessToken, refresh_token: t.refreshToken, token_type: t.tokenType ?? "Bearer", scope: t.scope, expiry_date: t.expiresAt };
}

async function gemini() {
  let creds = geminiCreds();
  if (!creds?.refresh_token) {
    console.log('Nếu hỏi "Do you want to continue? [Y/n]" → bấm Enter. Trình duyệt mở → chọn tài khoản Google có gói → Allow.');
    // Chế độ không tương tác: đăng nhập xong tự trả lời 1 câu rồi thoát (không cần /quit).
    await npx("gemini", ["-p", "Trả lời đúng một chữ: OK", "-o", "text"], {
      env: { GOOGLE_GENAI_USE_GCA: "true", GEMINI_FORCE_FILE_STORAGE: "true", GEMINI_DEFAULT_AUTH_TYPE: "oauth-personal", GEMINI_CLI_TRUST_WORKSPACE: "true" },
    });
    creds = geminiCreds();
  }
  if (!creds?.refresh_token) throw new Error("chưa đăng nhập xong Google.");
  return JSON.stringify(creds);
}

/** Token sk-ant-oat… trong output (bỏ mã màu; nối lại nếu bị xuống dòng giữa chừng). */
function findClaudeToken(text) {
  const lines = text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/sk-ant-oat[A-Za-z0-9_-]+/);
    if (!m) continue;
    let tok = m[0];
    for (let j = i + 1; j < lines.length && /^\s*[A-Za-z0-9_-]+\s*$/.test(lines[j]) && tok.length < 200; j++) tok += lines[j].trim();
    return tok;
  }
  return null;
}

async function claude() {
  console.log("Trình duyệt sẽ mở → đăng nhập Claude (tài khoản có gói Pro/Max) → Authorize. Nếu trang hiện mã, dán mã vào cửa sổ này.");
  const { out } = await npx("claude", ["setup-token"]);
  let token = findClaudeToken(out);
  if (!token || token.length < 60) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    token = (await rl.question("\nKhông tự đọc được token. Bôi đen dòng sk-ant-oat… ở trên, chuột phải để copy, rồi chuột phải dán vào đây + Enter:\n> ")).trim();
    rl.close();
  }
  if (!/^sk-ant-oat/.test(token)) throw new Error("token Claude không đúng dạng sk-ant-oat….");
  return token;
}

// ── Chạy

const gh = spawnSync("gh", ["auth", "status"], { encoding: "utf8", shell: win });
if (gh.status !== 0) {
  console.log("❌ Cần GitHub CLI đã đăng nhập: chạy `gh auth login` rồi chạy lại.");
  process.exit(1);
}

const saved = [];
for (const kind of kinds) {
  step(`${NAME[kind]}`);
  try {
    const value = await { codex, gemini, claude }[kind]();
    saveSecret(kind, value);
    saved.push(kind);
    console.log(`✅ ${NAME[kind]}: đã lưu vào GitHub Secrets (${SECRET[kind]}).`);
  } catch (e) {
    console.log(`⚠ ${NAME[kind]}: ${e instanceof Error ? e.message : e} — bỏ qua, chạy lại "node scripts/ai-login.mjs ${kind}" sau.`);
  }
}

if (saved.length) {
  step("Gọi thử trên GitHub Actions");
  const before = spawnSync("gh", ["run", "list", "--repo", REPO, "--workflow", "ai-check.yml", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"], { encoding: "utf8", shell: win }).stdout.trim();
  spawnSync("gh", ["workflow", "run", "ai-check.yml", "--repo", REPO, "--ref", "main"], { stdio: "inherit", shell: win });
  let id = before;
  for (let i = 0; i < 30 && id === before; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    id = spawnSync("gh", ["run", "list", "--repo", REPO, "--workflow", "ai-check.yml", "--limit", "1", "--json", "databaseId", "--jq", ".[0].databaseId"], { encoding: "utf8", shell: win }).stdout.trim();
  }
  console.log("Đang chạy (khoảng 1–2 phút)…");
  spawnSync("gh", ["run", "watch", id, "--repo", REPO, "--interval", "10"], { stdio: "ignore", shell: win });
  const log = spawnSync("gh", ["run", "view", id, "--repo", REPO, "--log"], { encoding: "utf8", shell: win, maxBuffer: 20 << 20 }).stdout;
  const lines = log.split("\n").map((l) => l.replace(/^[^\t]*\t[^\t]*\t\S+ /, "")).filter((l) => /^[✓✗–] /.test(l));
  console.log(lines.length ? lines.join("\n") : "Không đọc được kết quả — xem tab Actions → ai-check trên GitHub.");
}
console.log("\nXong. Có thể đóng cửa sổ này.");
