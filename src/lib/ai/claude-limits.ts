import { parseClaudeHeaders, parseClaudeUsage, type PlanWindow } from "./plan-limits";

const BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 15_000;

/**
 * Hạn mức gói Claude Pro từ token OAuth (CLAUDE_CODE_OAUTH_TOKEN). Thử lần lượt:
 * 1. GET /api/oauth/usage — trả five_hour / seven_day (cần token có quyền user:profile).
 * 2. Gọi /v1/messages 1 token rồi đọc header anthropic-ratelimit-unified-* (token `setup-token` chỉ có user:inference vẫn đọc được;
 *    tốn ~vài token của gói).
 * Trả [] nếu cả hai đều không đọc được — người gọi ghi "không đọc được".
 */
export async function fetchClaudeLimits(token: string): Promise<PlanWindow[]> {
  const headers = { Authorization: `Bearer ${token}`, "anthropic-beta": BETA };
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const windows = parseClaudeUsage(await res.json());
      if (windows.length) return windows;
    }
  } catch {
    /* thử cách 2 */
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { ...headers, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1, messages: [{ role: "user", content: "." }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return parseClaudeHeaders((name) => res.headers.get(name));
  } catch {
    return [];
  }
}
