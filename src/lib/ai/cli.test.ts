import { afterEach, describe, expect, it } from "vitest";
import { buildCommand, classify, extractJson, lastJson, parseOutput } from "./cli";
import { QuotaExhaustedError } from "./gemini";

const o = { home: "/tmp/h", model: "", system: "SYS", prompt: "PROMPT", cheap: false };
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("buildCommand", () => {
  it("không bao giờ đưa API key / secret khác vào CLI (để dùng gói, không tốn credit)", () => {
    Object.assign(process.env, { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b", GEMINI_API_KEY: "c", DATABASE_URL: "d", SECRETS_KEY: "e", PATH: "/usr/bin" });
    for (const kind of ["claude", "codex", "gemini"] as const) {
      const env = buildCommand(kind, o).env;
      for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "DATABASE_URL", "SECRETS_KEY"]) expect(env[k]).toBeUndefined();
      expect(env.PATH).toBe("/usr/bin");
      expect(env.HOME).toBe("/tmp/h");
    }
  });
  it("claude: JSON, tắt công cụ, system prompt riêng, prompt qua stdin", () => {
    const c = buildCommand("claude", { ...o, model: "opus" });
    expect(c.args).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--tools", "", "--system-prompt", "SYS", "--model", "opus"]));
    expect(c.stdin).toBe("PROMPT");
  });
  it("codex: sandbox read-only, ghi câu trả lời ra file, ghép system vào đầu", () => {
    const c = buildCommand("codex", { ...o, cheap: true });
    expect(c.args).toEqual(expect.arrayContaining(["exec", "--sandbox", "read-only", "-o", c.outFile!, "-"]));
    expect(c.args).toContain('model_reasoning_effort="low"');
    expect(c.args).not.toContain("-m");
    expect(c.stdin.startsWith("SYS")).toBe(true);
    expect(c.env.CODEX_HOME).toContain(".codex");
  });
  it("gemini: đăng nhập Google, thay system prompt, JSON", () => {
    const c = buildCommand("gemini", o);
    expect(c.args).toEqual(expect.arrayContaining(["-o", "json", "--skip-trust"]));
    expect(c.env).toMatchObject({ GEMINI_DEFAULT_AUTH_TYPE: "oauth-personal", GEMINI_FORCE_FILE_STORAGE: "true", GEMINI_CLI_HOME: "/tmp/h" });
    expect(c.env.GEMINI_SYSTEM_MD).toContain("system.md");
  });
});

describe("parseOutput", () => {
  it("claude thành công / lỗi hết lượt", () => {
    const ok = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Xin chào", modelUsage: { "claude-opus-5-5": {} } });
    expect(parseOutput("claude", `cảnh báo gì đó\n${ok}`)).toEqual({ text: "Xin chào", model: "claude-opus-5-5" });
    const lim = JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached" });
    expect(() => parseOutput("claude", lim)).toThrow(QuotaExhaustedError);
  });
  it("gemini thành công / lỗi", () => {
    expect(parseOutput("gemini", JSON.stringify({ response: "Hi", stats: { models: { "gemini-3-pro": {} } } }))).toEqual({ text: "Hi", model: "gemini-3-pro" });
    expect(() => parseOutput("gemini", JSON.stringify({ error: { message: "Quota exceeded" } }))).toThrow(QuotaExhaustedError);
  });
  it("codex đọc file câu trả lời", () => {
    expect(parseOutput("codex", "", "  Kết quả \n")).toEqual({ text: "Kết quả" });
    expect(() => parseOutput("codex", "boom", "")).toThrow();
  });
});

describe("classify", () => {
  it("phân biệt hết lượt / hết đăng nhập", () => {
    expect(classify("codex", "You've hit your usage limit")).toBeInstanceOf(QuotaExhaustedError);
    const auth = classify("gemini", "401 Unauthorized");
    expect(auth).not.toBeInstanceOf(QuotaExhaustedError);
    expect(auth.message).toContain("ai-login.mjs gemini");
  });
});

describe("extractJson / lastJson", () => {
  it("bỏ ```json``` và chữ thừa", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Đây: {"a":{"b":2}} nhé')).toEqual({ a: { b: 2 } });
    expect(() => extractJson("không có")).toThrow();
  });
  it("lastJson lấy object cuối", () => {
    expect(lastJson('log\n{"x":1}')).toEqual({ x: 1 });
    expect(lastJson("rỗng")).toBeNull();
  });
});
