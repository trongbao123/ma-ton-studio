// Gọi thử từng gói AI qua CLI (Claude Pro / ChatGPT Plus / Gemini) với câu hỏi ngắn; in kết quả và ghi trạng thái vào DB
// để trang Cài đặt AI hiện "đã kết nối". Chạy bởi workflow ai-check (scripts/ai-login.mjs tự kích hoạt sau khi lưu đăng nhập).
import { z } from "zod";
import { availableProviders, canRun, providerFor } from "@/lib/ai";
import { codexImage } from "@/lib/ai/cli";
import { saveCliStatus, type CliStatus } from "@/lib/ai/cli-status";
import { defaultRouting, isCli, PROVIDERS } from "@/lib/ai/routing";
import { loadSecrets } from "@/lib/secrets";

async function main() {
  await loadSecrets(true);
  const have = availableProviders();
  const status: CliStatus = {};
  const at = new Date().toISOString();
  let failed = 0;
  for (const p of PROVIDERS.filter((x) => isCli(x.id))) {
    if (!have.includes(p.id)) {
      console.log(`– ${p.label}: chưa kết nối`);
      continue;
    }
    if (!canRun(p.id)) {
      console.log(`✗ ${p.label}: máy này không có CLI "${p.cli}"`);
      status[p.id] = { ok: false, error: `không có CLI ${p.cli}`, at };
      failed++;
      continue;
    }
    // Gọi đúng model mặc định đang dùng (model rẻ của gói).
    const model = defaultRouting().story.find((x) => x.provider === p.id)?.model ?? "";
    const ai = providerFor({ provider: p.id, model });
    const started = Date.now();
    try {
      const out = await ai.generateJson({
        system: "Bạn là trợ lý ngắn gọn.",
        prompt: "Kiểm tra kết nối: đặt ok=true và viết 1 câu chào tiếng Việt vào greeting.",
        schema: z.object({ ok: z.boolean(), greeting: z.string() }),
        tier: "cheap",
      });
      console.log(`✓ ${p.label}: ${ai.lastModel} — "${out.greeting}" (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      status[p.id] = { ok: true, model: ai.lastModel, at };
    } catch (e) {
      failed++;
      const error = e instanceof Error ? e.message : String(e);
      console.log(`✗ ${p.label}: ${error}`);
      status[p.id] = { ok: false, error: error.slice(0, 300), at };
    }
  }
  // Thử vẽ 1 ảnh bằng Codex (gói Plus) — xác nhận công cụ vẽ chạy được trên máy này.
  if (process.env.CODEX_AUTH_JSON && canRun("codex-cli")) {
    const started = Date.now();
    try {
      const img = await codexImage(process.env.CODEX_AUTH_JSON, "a small red lotus on dark water, 3D render", "1:1");
      console.log(`✓ Codex vẽ ảnh: ${img.length} bytes (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`✗ Codex vẽ ảnh: ${e instanceof Error ? e.message : e}`);
    }
  }
  await saveCliStatus(status);
  process.exit(failed ? 1 : 0);
}

main();
