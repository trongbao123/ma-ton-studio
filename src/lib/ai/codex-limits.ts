import { spawn } from "node:child_process";
import { parseCodexRateLimits } from "./plan-limits";
import { savePlanLimits } from "./plan-limits-store";

const TIMEOUT_MS = 20_000;

/**
 * Hỏi hạn mức gói ChatGPT qua `codex app-server` (JSON-RPC `account/rateLimits/read`) — không gọi model nên không tốn lượt gói.
 * (`codex exec --json` KHÔNG phát token_count/rate_limits, đã đo trên codex-cli 0.166.) `env` phải có CODEX_HOME trỏ tới thư mục đã chứa auth.json.
 */
export function readCodexRateLimits(env: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { env: env as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const finish = (err: Error | null, value?: unknown) => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("codex app-server không trả lời")), TIMEOUT_MS);
    const send = (o: object) => child.stdin.write(`${JSON.stringify(o)}\n`);
    child.on("error", (e) => finish(e));
    child.stdout.on("data", (d: Buffer) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ method: "initialized" });
          send({ id: 2, method: "account/rateLimits/read" });
        } else if (msg.id === 2) {
          if (msg.error) finish(new Error(msg.error.message ?? "codex từ chối"));
          else finish(null, msg.result);
        }
      }
    });
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "ma-ton-studio", version: "1" } } });
  });
}

let lastRecordedAt = 0;

/** Đọc hạn mức gói và lưu snapshot (app_settings "plan_limits"). Tối đa 1 lần/phút; mọi lỗi chỉ cảnh báo. */
export async function recordCodexLimits(env: Record<string, string>) {
  if (Date.now() - lastRecordedAt < 60_000) return;
  lastRecordedAt = Date.now();
  try {
    const { windows, plan } = parseCodexRateLimits(await readCodexRateLimits(env));
    if (windows.length) await savePlanLimits("codex", { windows, plan, at: new Date().toISOString() });
  } catch (e) {
    console.warn("Không đọc được hạn mức Codex:", e instanceof Error ? e.message : e);
  }
}
