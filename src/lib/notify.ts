/**
 * Gửi tin Telegram tới điện thoại người dùng. Thiếu TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID thì bỏ qua;
 * lỗi gửi chỉ log, không làm hỏng việc chính.
 */
export async function notify(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) console.warn("Telegram lỗi:", res.status, await res.text());
  } catch (e) {
    console.warn("Telegram lỗi:", e);
  }
}

export const WEB_URL = process.env.WEB_URL ?? "https://ma-ton-studio.vercel.app";

export function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
