/** Các key người dùng dán trên trang Cài đặt AI — thuần, dùng được cả ở client. */
export type SecretGroup = "ai" | "service";
export type SecretKey = { env: string; label: string; group: SecretGroup; help: string; brand?: "claude" | "openai" | "gemini" | "cloudflare" | "youtube" };

export const SECRET_KEYS: SecretKey[] = [
  { env: "ANTHROPIC_API_KEY", label: "Claude", group: "ai", brand: "claude", help: "console.anthropic.com → API Keys" },
  { env: "OPENAI_API_KEY", label: "ChatGPT", group: "ai", brand: "openai", help: "platform.openai.com → API keys" },
  { env: "GEMINI_API_KEY", label: "Gemini", group: "ai", brand: "gemini", help: "aistudio.google.com → Get API key" },
  { env: "VIDIQ_API_KEY", label: "vidIQ", group: "service", help: "app.vidiq.com → Account Settings → MCP" },
  { env: "CLOUDFLARE_API_TOKEN", label: "Cloudflare token", group: "service", brand: "cloudflare", help: "dash.cloudflare.com → API Tokens (quyền Workers AI)" },
  { env: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare account ID", group: "service", brand: "cloudflare", help: "dash.cloudflare.com → trang tổng quan, cột phải" },
  { env: "YOUTUBE_CLIENT_ID", label: "YouTube OAuth client ID", group: "service", brand: "youtube", help: "Google Cloud → Credentials (xem README)" },
  { env: "YOUTUBE_CLIENT_SECRET", label: "YouTube OAuth client secret", group: "service", brand: "youtube", help: "Google Cloud → Credentials (xem README)" },
];

export const SECRETS_KEY = "api_keys";

/** Trạng thái hiển thị — không bao giờ gửi key thật về trình duyệt, chỉ 4 ký tự cuối. */
export type SecretStatus = { env: string; source: "web" | "env" | null; hint: string | null };
