import { readFile, rm, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { DEFAULT_IMAGE_MODEL, IMAGE_PROVIDERS, IMAGE_ROUTING_KEY, normalizeImageRouting, type ImageProviderId, type ImageRoute } from "@/lib/ai/routing";

/** Pollinations free không key: 1 ảnh / 45 giây / IP → xếp hàng tuần tự. Chỉ dùng khi không cấu hình Cloudflare. */
const GAP_MS = process.env.POLLINATIONS_TOKEN ? 0 : 46_000;
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CF_MODEL = process.env.CF_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL.cloudflare;
const cfUrl = (model = CF_MODEL) => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;
const hasCloudflare = () => Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
const cfHeaders = () => ({ Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" });
const isDaily = (s: string) => /daily free allocation|neurons/i.test(s);

/** Còn quota ảnh Cloudflare không — hỏi thẳng bằng 1 ảnh 1 bước (rất ít neuron). Quota reset không đúng nửa đêm nên không đoán theo giờ. */
export async function cloudflareReady() {
  if (!hasCloudflare()) return true;
  const res = await fetch(cfUrl(), {
    method: "POST",
    headers: cfHeaders(),
    body: JSON.stringify({ prompt: "a dot", steps: 1 }),
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);
  return !(res?.status === 429 && isDaily(await res.text()));
}

/** File ảnh hợp lệ (JPEG/PNG/WebP, > 10KB) — chặn file lỗi/HTML bị lưu nhầm làm hỏng ffmpeg ở lần sau. */
async function validImage(file: string) {
  const buf = await readFile(file).catch(() => null);
  if (!buf || buf.length < 10_000) return false;
  const jpg = buf[0] === 0xff && buf[1] === 0xd8;
  const png = buf.subarray(1, 4).toString("ascii") === "PNG";
  const webp = buf.subarray(8, 12).toString("ascii") === "WEBP";
  return jpg || png || webp;
}

async function saveImage(file: string, buf: Buffer) {
  await writeFile(file, buf);
  if (!(await validImage(file))) {
    await rm(file, { force: true });
    throw new Error("ảnh trả về không hợp lệ");
  }
}

type DrawOpts = { width: number; height: number; seed: number };

/** Có key cho AI vẽ này không (Cloudflare không token thì vẫn chạy bằng Pollinations). */
const hasKey = (p: ImageProviderId) => p === "cloudflare" || Boolean(process.env[IMAGE_PROVIDERS.find((x) => x.id === p)!.env]);

let routes: ImageRoute[] | null = null;

/** Thứ tự AI vẽ ảnh (trang Cài đặt AI) — đọc một lần mỗi job để cả video dùng cùng một bộ AI. */
export async function imageRouting(): Promise<ImageRoute[]> {
  if (routes) return routes;
  let raw: unknown = null;
  if (process.env.DATABASE_URL) {
    const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, IMAGE_ROUTING_KEY)).catch(() => []);
    raw = row?.value ?? null;
  }
  const list = normalizeImageRouting(raw).filter((r) => hasKey(r.provider));
  routes = list.length ? list : [{ provider: "cloudflare", model: "" }];
  return routes;
}

/**
 * Còn vẽ được không trước khi render: có AI vẽ trả phí trong danh sách thì luôn được;
 * chỉ có Cloudflare thì hỏi quota (hết thì chờ, không ra video ảnh mờ).
 */
export async function imagesReady() {
  const list = await imageRouting();
  return list.some((r) => r.provider !== "cloudflare") || (await cloudflareReady());
}

/**
 * Vẽ 1 ảnh: thử lần lượt các AI vẽ theo cài đặt. AI nào hết quota/lỗi thì sang AI sau;
 * tất cả hết quota → QuotaExhaustedError để video chờ lượt sau (ảnh đã vẽ được cache).
 * Không chèn ảnh Pollinations free xấu khi đã có Cloudflare.
 */
export async function drawImage(prompt: string, outFile: string, opts: DrawOpts) {
  if (await validImage(outFile)) return;
  await rm(outFile, { force: true });
  const list = await imageRouting();
  let quota = 0;
  let last: unknown;
  for (const r of list) {
    try {
      if (r.provider === "gemini") return await geminiImage(prompt, outFile, r.model || DEFAULT_IMAGE_MODEL.gemini, opts);
      if (r.provider === "openai") return await openaiImage(prompt, outFile, r.model || DEFAULT_IMAGE_MODEL.openai, opts);
      return await (hasCloudflare() ? cloudflareFlux(prompt, outFile, r.model || CF_MODEL) : pollinations(prompt, outFile, opts));
    } catch (e) {
      last = e;
      if (e instanceof QuotaExhaustedError) quota++;
      if (list.length > 1) console.warn(`⚠ Vẽ ảnh bằng ${r.provider} lỗi, thử AI vẽ kế tiếp:`, e instanceof Error ? e.message.slice(0, 200) : e);
    }
  }
  if (quota === list.length) throw last;
  throw last instanceof Error ? last : new Error(String(last));
}

const aspect = (o: DrawOpts) => (o.width > o.height ? "16:9" : o.width < o.height ? "9:16" : "1:1");

/** Gemini Nano Banana qua Interactions API (cùng GEMINI_API_KEY). */
async function geminiImage(prompt: string, outFile: string, model: string, opts: DrawOpts) {
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json", "Api-Revision": "2026-05-20" },
      body: JSON.stringify({
        model,
        input: prompt.slice(0, 4000),
        response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: aspect(opts), image_size: "1K" },
      }),
      signal: AbortSignal.timeout(180_000),
    }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (res instanceof Error) {
      last = res.message;
    } else {
      type Block = { type?: string; data?: string };
      const body = await res.json().catch(() => ({}));
      const blocks: Block[] = (body?.steps ?? []).flatMap((s: { content?: Block[] }) => s.content ?? []);
      const data: string | undefined = body?.output_image?.data ?? blocks.findLast((b) => b.type === "image" && b.data)?.data;
      if (res.ok && data) return saveImage(outFile, Buffer.from(data, "base64"));
      last = `${res.status} ${body?.error?.message ?? "không có ảnh"}`;
      if (res.status === 429 && /per day|quota|billing/i.test(last)) throw new QuotaExhaustedError(`Gemini hết quota vẽ ảnh: ${last}`);
      if (res.status !== 429 && res.status < 500) break;
    }
    await sleep(5_000 * (attempt + 1));
  }
  throw new Error(`Gemini vẽ ảnh lỗi: ${last}`);
}

let openai: OpenAI | undefined;

/** GPT Image của OpenAI (cùng OPENAI_API_KEY). */
async function openaiImage(prompt: string, outFile: string, model: string, opts: DrawOpts) {
  openai ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const a = aspect(opts);
  try {
    const res = await openai.images.generate({
      model,
      prompt: prompt.slice(0, 4000),
      size: a === "16:9" ? "1536x1024" : a === "9:16" ? "1024x1536" : "1024x1024",
      quality: "medium",
      output_format: "jpeg",
      n: 1,
    });
    const data = res.data?.[0]?.b64_json;
    if (!data) throw new Error("OpenAI không trả ảnh");
    await saveImage(outFile, Buffer.from(data, "base64"));
  } catch (e) {
    if (e instanceof OpenAI.RateLimitError && /insufficient_quota|quota|billing/i.test(e.message)) {
      throw new QuotaExhaustedError(`OpenAI hết hạn mức vẽ ảnh: ${e.message}`);
    }
    throw e;
  }
}

/** Flux trên Cloudflare Workers AI: ảnh vuông 1024×1024, free 10k neuron/ngày (~1 video). */
async function cloudflareFlux(prompt: string, outFile: string, model = CF_MODEL) {
  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(cfUrl(model), {
        method: "POST",
        headers: cfHeaders(),
        body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 4 }),
        signal: AbortSignal.timeout(120_000),
      });
      const body = await res.json().catch(() => ({}));
      const image = body?.result?.image;
      if (res.ok && image) {
        await saveImage(outFile, Buffer.from(image, "base64"));
        return;
      }
      last = `${res.status} ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`;
      if (res.status === 429 && isDaily(last)) throw new QuotaExhaustedError("Hết quota ảnh Cloudflare — video chờ lượt sau.");
    } catch (e) {
      if (e instanceof QuotaExhaustedError) throw e;
      last = String(e);
    }
    await sleep(5_000 * (attempt + 1));
  }
  throw new Error(`Cloudflare Flux lỗi: ${last}`);
}

function pollinations(prompt: string, outFile: string, opts: { width: number; height: number; seed: number }) {
  const job = queue.then(() => fetchImage(prompt, outFile, opts));
  queue = job.catch(() => {});
  return job;
}

async function fetchImage(prompt: string, outFile: string, opts: { width: number; height: number; seed: number }) {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}`);
  url.searchParams.set("width", String(opts.width));
  url.searchParams.set("height", String(opts.height));
  url.searchParams.set("seed", String(opts.seed));
  url.searchParams.set("nologo", "true");
  const headers: Record<string, string> = {};
  if (process.env.POLLINATIONS_TOKEN) headers.Authorization = `Bearer ${process.env.POLLINATIONS_TOKEN}`;

  // IP máy GitHub dùng chung nên hay bị giới hạn → thử tới 15 phút cho mỗi ảnh.
  const deadline = Date.now() + 15 * 60_000;
  let last = "";
  for (let attempt = 0; Date.now() < deadline; attempt++) {
    await sleep(Math.max(0, lastAt + GAP_MS - Date.now()));
    lastAt = Date.now();
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.startsWith("image/")) {
        await saveImage(outFile, Buffer.from(await res.arrayBuffer()));
        return;
      }
      const body = await res.text();
      last = `${res.status} ${body.slice(0, 200)}`;
      const retryAfter = Number(body.match(/Retry after (\d+)s/)?.[1]);
      if (retryAfter) lastAt = Date.now() + retryAfter * 1000 + 2000 - GAP_MS;
      else await sleep(Math.min(60_000, 10_000 * (attempt + 1)));
    } catch (e) {
      last = String(e);
      await sleep(10_000);
    }
  }
  throw new Error(`Tạo ảnh lỗi: ${last}`);
}
