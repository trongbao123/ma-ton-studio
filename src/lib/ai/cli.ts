import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { recordCodexLimits } from "./codex-limits";
import { QuotaExhaustedError } from "./gemini";
import type { JsonRequest, TextProvider, TextRequest } from "./types";
import { recordUsage } from "./usage";

/**
 * Gọi Claude Code / Codex / Gemini CLI ở chế độ không giao diện, đăng nhập bằng gói Pro/Plus của người dùng
 * → không tốn credit API. Chỉ chạy ở GitHub Actions (Linux, đã cài CLI trong workflow); Vercel không có CLI nên tự bỏ qua.
 *
 * An toàn: tiến trình con chỉ nhận vài biến môi trường cần thiết (danh sách trắng) — không lộ DATABASE_URL, key khác,
 * và quan trọng là không có ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY, nếu có CLI sẽ dùng API key (tốn tiền) thay vì gói.
 * Chạy trong thư mục tạm rỗng, tắt công cụ (không đọc/sửa file, không chạy lệnh).
 */

export type CliKind = "claude" | "codex" | "gemini";

const TIMEOUT_MS = 20 * 60_000;
const PASS_ENV = ["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];

/** CLI có trong PATH không (Windows không hỗ trợ — chỉ dùng trên runner Linux). */
export function cliReady(kind: CliKind) {
  if (process.platform === "win32") return false;
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => dir && existsSync(path.join(dir, kind)));
}

export function baseEnv(home: string): Record<string, string> {
  const env: Record<string, string> = { HOME: home, CI: "1", NO_COLOR: "1" };
  for (const k of PASS_ENV) if (process.env[k]) env[k] = process.env[k]!;
  return env;
}

export type Command = { bin: CliKind; args: string[]; env: Record<string, string>; stdin: string; outFile?: string };

/** Dựng lệnh cho từng CLI — thuần, để test. `home` là thư mục tạm đã chứa file đăng nhập. */
export function buildCommand(kind: CliKind, o: { home: string; model: string; system: string; prompt: string; cheap: boolean }): Command {
  const env = baseEnv(o.home);
  if (kind === "claude") {
    return {
      bin: "claude",
      args: [
        "-p",
        "--output-format", "json",
        "--tools", "",
        "--no-session-persistence",
        "--strict-mcp-config",
        "--system-prompt", o.system,
        ...(o.model ? ["--model", o.model] : []),
      ],
      env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: "", DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
      stdin: o.prompt,
    };
  }
  if (kind === "codex") {
    const outFile = path.join(o.home, "last-message.txt");
    return {
      bin: "codex",
      args: [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox", "read-only",
        "--color", "never",
        "-c", `model_reasoning_effort="${o.cheap ? "low" : "medium"}"`,
        "-o", outFile,
        ...(o.model ? ["-m", o.model] : []),
        "-",
      ],
      env: { ...env, CODEX_HOME: path.join(o.home, ".codex") },
      // Codex không có cờ system prompt riêng → ghép vào đầu.
      stdin: `${o.system}\n\n---\n\n${o.prompt}`,
      outFile,
    };
  }
  return {
    bin: "gemini",
    args: ["-p", "Thực hiện đúng yêu cầu ở trên.", "-o", "json", "--skip-trust", ...(o.model ? ["-m", o.model] : [])],
    env: {
      ...env,
      GEMINI_CLI_HOME: o.home,
      GEMINI_FORCE_FILE_STORAGE: "true",
      GEMINI_DEFAULT_AUTH_TYPE: "oauth-personal",
      // Chế độ không tương tác chỉ nhận đăng nhập Google khi có biến này (settings.json là dự phòng).
      GOOGLE_GENAI_USE_GCA: "true",
      GEMINI_CLI_TRUST_WORKSPACE: "true",
      GEMINI_CLI_NO_RELAUNCH: "true",
      // Thay hẳn system prompt "trợ lý lập trình" của CLI bằng system của việc này.
      GEMINI_SYSTEM_MD: path.join(o.home, "system.md"),
    },
    stdin: o.prompt,
  };
}

/** Chuẩn bị thư mục tạm: file đăng nhập cho từng CLI. */
async function prepareHome(kind: CliKind, cred: string, system: string) {
  const home = await mkdtemp(path.join(os.tmpdir(), `ai-${kind}-`));
  if (kind === "codex") {
    await mkdir(path.join(home, ".codex"), { recursive: true });
    await writeFile(path.join(home, ".codex", "auth.json"), cred, { mode: 0o600 });
  }
  if (kind === "gemini") {
    const dir = path.join(home, ".gemini");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "oauth_creds.json"), cred, { mode: 0o600 });
    await writeFile(path.join(dir, "settings.json"), JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }));
    await writeFile(path.join(home, "system.md"), system);
  }
  return home;
}

/** Lấy object JSON cuối cùng trong stdout (CLI đôi khi in cảnh báo trước). */
export function lastJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const lines = t.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trimStart().startsWith("{")) continue;
      try {
        return JSON.parse(lines.slice(i).join("\n"));
      } catch {
        /* thử dòng trước */
      }
    }
    return null;
  }
}

const QUOTA = /usage limit|rate.?limit|quota|\b429\b|resource.?exhausted|limit reached|hit your limit|too many requests|out of credits/i;
const AUTH = /\b401\b|unauthori[sz]ed|not logged in|please log ?in|invalid.{0,20}(token|credential|grant)|expired|authenticat/i;

export function classify(kind: CliKind, message: string): Error {
  const msg = message.replace(/\s+/g, " ").trim().slice(0, 300) || "lỗi không rõ";
  if (QUOTA.test(msg)) return new QuotaExhaustedError(`${kind} (gói) hết lượt: ${msg}`);
  if (AUTH.test(msg)) return new Error(`${kind} (gói) đăng nhập hết hạn — chạy lại "node scripts/ai-login.mjs ${kind}" rồi dán vào Cài đặt AI. (${msg})`);
  return new Error(`${kind} (gói) lỗi: ${msg}`);
}

/** Đọc kết quả từ stdout / file — thuần, để test. */
export function parseOutput(kind: CliKind, stdout: string, lastMessage?: string): { text: string; model?: string } {
  if (kind === "codex") {
    const text = (lastMessage ?? "").trim();
    if (!text) throw classify(kind, stdout || "Codex không trả lời.");
    return { text };
  }
  const j = lastJson(stdout);
  if (!j) throw classify(kind, stdout || "không có JSON trả về");
  if (kind === "claude") {
    if (j.is_error || j.subtype !== "success") throw classify(kind, String(j.result ?? j.subtype ?? "lỗi"));
    const model = Object.keys((j.modelUsage as object) ?? {})[0];
    return { text: String(j.result ?? "").trim(), model };
  }
  const err = j.error as { message?: string } | undefined;
  if (err) throw classify(kind, err.message ?? JSON.stringify(err));
  const models = ((j.stats as { models?: object } | undefined)?.models ?? {}) as object;
  return { text: String(j.response ?? "").trim(), model: Object.keys(models)[0] };
}

function run(cmd: Command, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.bin, cmd.args, { cwd, env: cmd.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(cmd.stdin);
  });
}

/** Lấy object JSON từ câu trả lời dạng chữ (bỏ ```json … ``` nếu có). */
export function extractJson(text: string): unknown {
  const t = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("Câu trả lời không phải JSON.");
  }
}

export class CliProvider implements TextProvider {
  readonly name: string;
  lastModel?: string;

  constructor(
    private readonly kind: CliKind,
    private readonly cred: string,
    private readonly model: string,
    /** Codex làm mới token và ghi lại auth.json → lưu bản mới để lần sau không bị đăng xuất. */
    private readonly persist?: (cred: string) => Promise<void>,
  ) {
    this.name = `${kind}-cli`;
  }

  async generateText(req: TextRequest): Promise<string> {
    const home = await prepareHome(this.kind, this.cred, req.system);
    try {
      const cmd = buildCommand(this.kind, { home, model: this.model, system: req.system, prompt: req.prompt, cheap: req.tier === "cheap" });
      if (this.kind === "claude") cmd.env.CLAUDE_CODE_OAUTH_TOKEN = this.cred;
      const work = path.join(home, "work");
      await mkdir(work, { recursive: true });
      const res = await run(cmd, work);
      const last = cmd.outFile ? await readFile(cmd.outFile, "utf8").catch(() => "") : undefined;
      let out: ReturnType<typeof parseOutput>;
      try {
        if (res.code !== 0 && !last && !lastJson(res.stdout)) throw classify(this.kind, `${res.stderr}\n${res.stdout}`.trim().slice(-600));
        out = parseOutput(this.kind, res.stdout, last);
      } catch (e) {
        // Hết lượt gói → ghi lại để trang Hạn mức AI hiện "chạm giới hạn".
        if (e instanceof QuotaExhaustedError) void recordUsage(`${this.model || this.kind} (gói)`, true);
        throw e;
      }
      if (!out.text) throw classify(this.kind, "trả về rỗng");
      if (this.kind === "codex") await recordCodexLimits(cmd.env);
      if (this.kind === "codex" && this.persist) {
        const fresh = await readFile(path.join(home, ".codex", "auth.json"), "utf8").catch(() => "");
        if (fresh && fresh.trim() !== this.cred.trim()) await this.persist(fresh).catch((e) => console.warn("Không lưu được token Codex mới:", e));
      }
      this.lastModel = `${out.model ?? (this.model || this.kind)} (gói)`;
      void recordUsage(this.lastModel, false);
      return out.text;
    } finally {
      await rm(home, { recursive: true, force: true }).catch(() => {});
    }
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<T> {
    const schema = JSON.stringify(z.toJSONSchema(req.schema));
    const ask = `${req.prompt}\n\n---\nTRẢ LỜI: chỉ MỘT object JSON hợp lệ, không markdown, không giải thích, đúng JSON Schema sau:\n${schema}`;
    let error = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await this.generateText({ ...req, prompt: attempt ? `${ask}\n\nLần trước JSON sai (${error}). Trả lại đúng khuôn.` : ask });
      try {
        return req.schema.parse(extractJson(text));
      } catch (e) {
        error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      }
    }
    throw new Error(`${this.kind} (gói) trả JSON không đúng khuôn: ${error}`);
  }
}

const CODEX_IMAGE_MODEL = process.env.CODEX_IMAGE_MODEL ?? "gpt-6-luna";

/** File ảnh mới nhất Codex lưu trong CODEX_HOME/generated_images (công cụ vẽ ảnh của Codex tự lưu ở đó). */
async function newestImage(dir: string): Promise<string | null> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[]);
  let best: { file: string; at: number } | null = null;
  for (const e of entries) {
    if (!/\.(png|jpe?g|webp)$/i.test(e)) continue;
    const file = path.join(dir, e);
    const at = (await stat(file)).mtimeMs;
    if (!best || at > best.at) best = { file, at };
  }
  return best?.file ?? null;
}

/**
 * Chạy Codex tới khi ảnh xuất hiện (kích thước đứng yên 2 lần đo) rồi tắt luôn — Codex đôi khi treo ở bước
 * kết nối lại sau khi đã vẽ xong, chờ nó tự thoát là phí tới 20 phút.
 */
function runUntilImage(cmd: Command, cwd: string, imageDir: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.bin, cmd.args, { cwd, env: cmd.env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let lastSize = -1;
    const done = () => {
      clearInterval(poll);
      clearTimeout(timer);
      resolve({ stdout, stderr });
    };
    const poll = setInterval(async () => {
      const img = await newestImage(imageDir);
      const size = img ? (await stat(img).catch(() => null))?.size ?? -1 : -1;
      if (size > 0 && size === lastSize) child.kill("SIGKILL");
      lastSize = size;
    }, 3000);
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d));
    child.stderr.on("data", (d: Buffer) => (stderr += d));
    child.on("error", (e) => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", done);
    child.stdin.end(cmd.stdin);
  });
}

/**
 * Vẽ 1 ảnh bằng công cụ vẽ của Codex, đăng nhập gói ChatGPT Plus (không tốn credit API).
 * Sandbox read-only: Codex chỉ gọi công cụ vẽ, ảnh tự lưu vào CODEX_HOME → mình tự lấy file.
 */
export async function codexImage(
  cred: string,
  prompt: string,
  aspect: "16:9" | "9:16" | "1:1",
  persist?: (cred: string) => Promise<void>,
): Promise<Buffer> {
  const home = await prepareHome("codex", cred, "");
  try {
    const work = path.join(home, "work");
    await mkdir(work, { recursive: true });
    const cmd: Command = {
      bin: "codex",
      // Model chat chỉ cần gọi công cụ vẽ 1 lần → dùng model rẻ nhất, suy nghĩ tối thiểu để đỡ tốn lượt gói.
      args: [
        "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--color", "never",
        "-m", CODEX_IMAGE_MODEL, "-c", 'model_reasoning_effort="low"', "-c", "features.image_generation=true", "-",
      ],
      env: { ...baseEnv(home), CODEX_HOME: path.join(home, ".codex") },
      stdin: `Use your image generation tool to create exactly ONE image, aspect ratio ${aspect}. Do not ask questions, do not write files, just generate it.\n\nImage prompt: ${prompt}`,
    };
    const res = await runUntilImage(cmd, work, path.join(home, ".codex", "generated_images"));
    const img = await newestImage(path.join(home, ".codex", "generated_images"));
    if (!img) throw classify("codex", `${res.stderr}\n${res.stdout}`.trim().slice(-600) || "Codex không vẽ ra ảnh.");
    await recordCodexLimits(cmd.env);
    if (persist) {
      const fresh = await readFile(path.join(home, ".codex", "auth.json"), "utf8").catch(() => "");
      if (fresh && fresh.trim() !== cred.trim()) await persist(fresh).catch((e) => console.warn("Không lưu được token Codex mới:", e));
    }
    return await readFile(img);
  } finally {
    await rm(home, { recursive: true, force: true }).catch(() => {});
  }
}
