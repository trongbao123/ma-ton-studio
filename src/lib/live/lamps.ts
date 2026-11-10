import { DAILY_LIMIT, lampOf, type Lamp, type SourceDay } from "@/lib/ai/sources";
import type { LiveStatus } from "./types";

export type BrandLamp = {
  key: string;
  label: string;
  brand: "claude" | "openai" | "gemini" | "cloudflare";
  lamp: Lamp;
  calls: number;
  limit?: number;
  note?: string;
};

function merge(...days: (SourceDay | undefined)[]): SourceDay | undefined {
  if (!days.some(Boolean)) return undefined;
  return {
    calls: days.reduce((n, d) => n + (d?.calls ?? 0), 0),
    limited: days.every((d) => !d || d.limited),
    partial: days.some((d) => d?.limited || d?.partial),
    models: [],
  };
}

/** Ảnh: GPT (gói Plus) vẽ chính, Cloudflare/DeepInfra dự phòng — chỉ đỏ khi mọi nguồn đều chạm giới hạn. */
function imagesLamp(today: LiveStatus["today"]): BrandLamp {
  const gpt = today["chatgpt-image"];
  const cf = today.cloudflare;
  const d = merge(gpt, cf, today.deepinfra);
  const lamp: Lamp = d?.limited ? "limited" : d?.partial ? "partial" : d?.calls ? "active" : "idle";
  return { key: "images", label: "Ảnh", brand: "openai", lamp, calls: d?.calls ?? 0, note: `GPT ${gpt?.calls ?? 0} · Cloudflare ${cf?.calls ?? 0}${cf?.limited ? " (hết)" : ""}` };
}

/** Năm đèn hạn mức trên thanh trên cùng — thuần, dùng cho cả lần render server đầu tiên lẫn cập nhật realtime ở client. */
export function buildLamps({ today, cliOk }: Pick<LiveStatus, "today" | "cliOk">): BrandLamp[] {
  return [
    { key: "claude", label: "Claude", brand: "claude", lamp: lampOf(today["claude-plan"], cliOk.claude), calls: today["claude-plan"]?.calls ?? 0, note: "gói không công bố số lượt" },
    { key: "chatgpt", label: "ChatGPT", brand: "openai", lamp: lampOf(today["chatgpt-plan"], cliOk.chatgpt), calls: today["chatgpt-plan"]?.calls ?? 0, note: "gói không công bố số lượt" },
    {
      key: "gemini", label: "Gemini", brand: "gemini", lamp: lampOf(today["gemini-free"], true),
      calls: today["gemini-free"]?.calls ?? 0, limit: DAILY_LIMIT["gemini-free"], note: "họ flash ~20/ngày; model lite/gemma có lượt riêng",
    },
    {
      key: "voice", label: "Giọng", brand: "gemini", lamp: lampOf(today.voice, true),
      calls: today.voice?.calls ?? 0, limit: DAILY_LIMIT.voice, note: "model giọng chính 10/ngày; hết thì sang model dự phòng",
    },
    imagesLamp(today),
  ];
}
