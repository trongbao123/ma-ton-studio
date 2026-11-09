// Gọi thử từng AI dùng gói (CLI) với câu hỏi ngắn: in model + câu trả lời hoặc lỗi. Không ghi gì vào DB (trừ token Codex làm mới).
import { z } from "zod";
import { availableProviders, canRun, providerFor } from "@/lib/ai";
import { isCli, PROVIDERS } from "@/lib/ai/routing";
import { loadSecrets } from "@/lib/secrets";
import { closeVidiq, listVidiqTools } from "./vidiq";

async function main() {
  await loadSecrets(true);
  const have = availableProviders();
  let failed = 0;
  for (const p of PROVIDERS.filter((x) => isCli(x.id))) {
    if (!have.includes(p.id)) {
      console.log(`– ${p.label}: chưa dán đăng nhập`);
      continue;
    }
    if (!canRun(p.id)) {
      console.log(`✗ ${p.label}: máy này không có CLI "${p.cli}"`);
      failed++;
      continue;
    }
    const ai = providerFor({ provider: p.id, model: "" });
    const started = Date.now();
    try {
      const out = await ai.generateJson({
        system: "Bạn là trợ lý ngắn gọn.",
        prompt: "Kiểm tra kết nối: đặt ok=true và viết 1 câu chào tiếng Việt vào greeting.",
        schema: z.object({ ok: z.boolean(), greeting: z.string() }),
        tier: "cheap",
      });
      console.log(`✓ ${p.label}: ${ai.lastModel} — "${out.greeting}" (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (e) {
      failed++;
      console.log(`✗ ${p.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (process.env.VIDIQ_API_KEY) {
    console.log("\nTool vidIQ:");
    for (const t of await listVidiqTools()) console.log(`- ${t.name}(${t.args.join(", ")}): ${t.description}`);
    await closeVidiq();
  }
  process.exit(failed ? 1 : 0);
}

main();
