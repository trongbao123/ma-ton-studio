/** Các key người dùng dán trên trang Cài đặt AI — thuần, dùng được cả ở client. */
export type SecretGroup = "ai" | "service";
export type SecretKey = { env: string; label: string; group: SecretGroup; help: string; brand?: "claude" | "openai" | "gemini" | "cloudflare" | "youtube" };

export const SECRET_KEYS: SecretKey[] = [
  // Gói Pro/Plus qua CLI — không tốn credit API, chạy trong job GitHub Actions. Lấy bằng `node scripts/ai-login.mjs`.
  { env: "CLAUDE_CODE_OAUTH_TOKEN", label: "Claude — gói Pro (không tốn credit)", group: "ai", brand: "claude", help: "Máy bạn: node scripts/ai-login.mjs claude → dán token sk-ant-oat…" },
  { env: "CODEX_AUTH_JSON", label: "ChatGPT — gói Plus (không tốn credit)", group: "ai", brand: "openai", help: "Máy bạn: node scripts/ai-login.mjs codex → dán (đã copy sẵn)" },
  { env: "GEMINI_OAUTH_CREDS", label: "Gemini — gói Google (không tốn credit)", group: "ai", brand: "gemini", help: "Máy bạn: node scripts/ai-login.mjs gemini → dán (đã copy sẵn)" },
  { env: "ANTHROPIC_API_KEY", label: "Claude API (trả theo lượng dùng)", group: "ai", brand: "claude", help: "console.anthropic.com → API Keys" },
  { env: "OPENAI_API_KEY", label: "ChatGPT API (trả theo lượng dùng)", group: "ai", brand: "openai", help: "platform.openai.com → API keys" },
  { env: "GEMINI_API_KEY", label: "Gemini API (free có giới hạn)", group: "ai", brand: "gemini", help: "aistudio.google.com → Get API key" },
  { env: "VIDIQ_API_KEY", label: "vidIQ", group: "service", help: "app.vidiq.com → Account Settings → MCP" },
  { env: "DEEPINFRA_API_KEY", label: "DeepInfra (vẽ ảnh dự phòng)", group: "service", help: "deepinfra.com → Dashboard → API Keys · ~0,002 USD/ảnh FLUX" },
  { env: "CLOUDFLARE_API_TOKEN", label: "Cloudflare token", group: "service", brand: "cloudflare", help: "dash.cloudflare.com → API Tokens (quyền Workers AI)" },
  { env: "CLOUDFLARE_ACCOUNT_ID", label: "Cloudflare account ID", group: "service", brand: "cloudflare", help: "dash.cloudflare.com → trang tổng quan, cột phải" },
  { env: "YOUTUBE_CLIENT_ID", label: "YouTube OAuth client ID", group: "service", brand: "youtube", help: "Google Cloud → Credentials (xem README)" },
  { env: "YOUTUBE_CLIENT_SECRET", label: "YouTube OAuth client secret", group: "service", brand: "youtube", help: "Google Cloud → Credentials (xem README)" },
  { env: "FB_APP_ID", label: "Facebook App ID", group: "service", help: "developers.facebook.com → Ứng dụng của tôi → Cài đặt → Cơ bản" },
  { env: "FB_APP_SECRET", label: "Facebook App Secret", group: "service", help: "developers.facebook.com → Cài đặt → Cơ bản → Khoá bí mật" },
  { env: "TAVILY_API_KEY", label: "Tavily (tìm tư liệu web cho kênh lịch sử)", group: "service", help: "app.tavily.com → API Keys · free 1.000 lượt/tháng" },
];

export const SECRETS_KEY = "api_keys";

/** Trạng thái hiển thị — không bao giờ gửi key thật về trình duyệt, chỉ 4 ký tự cuối. */
export type SecretStatus = { env: string; source: "web" | "env" | null; hint: string | null };
