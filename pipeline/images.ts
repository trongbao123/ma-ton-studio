import { readFile, rm, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { QuotaExhaustedError } from "@/lib/ai";
import { cliReady, codexImage } from "@/lib/ai/cli";
import { saveSecret } from "@/lib/secrets";
import { recordUsage } from "@/lib/ai/usage";
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
const hasKey = (p: ImageProviderId) =>
  p === "cloudflare" || (Boolean(process.env[IMAGE_PROVIDERS.find((x) => x.id === p)!.env]) && (p !== "codex" || cliReady("codex")));

let routes: ImageRoute[] | null = null;

/** Thứ tự AI vẽ ảnh (trang Cài đặt AI) — đọc một lần mỗi job để cả video dùng cùng một bộ AI. */
export async function imageRouting(): Promise<ImageRoute[]> {
  if (routes) return routes;
  let raw: unknown = null;
  if (process.env.DATABASE_URL) {
    const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, IMAGE_ROUTING_KEY)).catch(() => []);
    raw = row?.value ?? null;
  }
  // FLUX (Cloudflare/DeepInfra) vẽ xấu so với GPT → bỏ hẳn: GPT hết lượt thì video chờ lượt sau. IMAGE_ALLOW_FLUX=1 để bật lại.
  const allowFlux = process.env.IMAGE_ALLOW_FLUX === "1";
  const isFlux = (p: ImageProviderId) => p === "cloudflare" || p === "deepinfra";
  const list = normalizeImageRouting(raw).filter((r) => hasKey(r.provider) && (allowFlux || !isFlux(r.provider)));
  // Có gói ChatGPT Plus (Codex) mà chưa xếp → đưa lên đầu: ảnh đẹp nhất, không tốn tiền; hết lượt gói thì sang AI sau.
  if (hasKey("codex") && !list.some((r) => r.provider === "codex")) list.unshift({ provider: "codex", model: "" });
  // Có key DeepInfra mà chưa xếp vào danh sách → tự thêm cuối làm dự phòng (Cloudflare free hết quota thì vẽ tiếp, khỏi chờ 7h sáng).
  if (allowFlux && hasKey("deepinfra") && !list.some((r) => r.provider === "deepinfra")) list.push({ provider: "deepinfra", model: "" });
  routes = list.length ? list : [{ provider: allowFlux ? "cloudflare" : "codex", model: "" }];
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
/** Trả tên model đã vẽ (undefined nếu ảnh có sẵn trong cache) — để màn flow / trang Hạn mức biết AI nào vẽ. */
export function drawImage(prompt: string, outFile: string, opts: DrawOpts): Promise<string | undefined> {
  // Nhiều cảnh dùng chung 1 ảnh và chạy song song → chỉ vẽ 1 lần (Codex mất vài phút/ảnh, vẽ trùng là phí lượt gói).
  let job = inflight.get(outFile);
  if (!job) {
    job = drawOnce(prompt, outFile, opts).finally(() => inflight.delete(outFile));
    inflight.set(outFile, job);
  }
  return job;
}

/** OpenAI chặn prompt vì kiểm duyệt (bạo lực, máu me…) — khác hết lượt: sửa prompt là vẽ được. */
export const isModerationBlock = (e: unknown) => /moderation_blocked|safety_violations|content_policy/i.test(e instanceof Error ? e.message : String(e));

/** Từ ngữ hay làm prompt cảnh đánh nhau bị chặn — bỏ đi, giữ không khí căng thẳng mà không máu me. */
const GRAPHIC = /\b(blood(y|ied|stained|-soaked)?|gore|gory|wounds?|wounded|bleeding|corpses?|dead bod(y|ies)|severed|dismember\w*|decapitat\w*|impal\w*|stab(bed|bing|s)?|slit|gash(es)?|mutilat\w*|carnage|massacre|torture\w*|suicid\w*|self-harm|kill(s|ed|ing)?|murder\w*|guts|entrails|skulls?|bones? (piercing|breaking)|broken bones?|crushed skull)\b/gi;

/** Bản prompt "dịu" để vẽ lại khi bị chặn kiểm duyệt: bỏ từ máu me, thêm ràng buộc an toàn, giữ bố cục và cảm xúc. */
export function softenPrompt(prompt: string) {
  const clean = prompt.replace(GRAPHIC, "").replace(/\s+([,.;])/g, "$1").replace(/,\s*,+/g, ",").replace(/\s{2,}/g, " ").trim();
  return `${clean}, dramatic but non-graphic, no blood, no gore, no injuries, no dead bodies, epic fantasy energy and tension instead of violence, cinematic, PG-13`;
}

async function codexDraw(prompt: string, outFile: string, model: string, opts: DrawOpts) {
  const draw = (p: string) => codexImage(process.env.CODEX_AUTH_JSON!, p, aspect(opts), (fresh) => saveSecret("CODEX_AUTH_JSON", fresh));
  try {
    let buf: Buffer;
    try {
      buf = await draw(prompt);
    } catch (e) {
      // Bị chặn kiểm duyệt: vẽ lại 1 lần bằng prompt dịu thay vì bỏ sang AI khác (Cloudflare có thể đã hết quota → cả chương phải chờ).
      if (!isModerationBlock(e)) throw e;
      console.warn("⚠ Ảnh bị OpenAI chặn kiểm duyệt — vẽ lại bằng prompt dịu hơn");
      buf = await draw(softenPrompt(prompt));
    }
    await saveImage(outFile, buf);
    void recordUsage(model, false);
  } catch (e) {
    if (e instanceof QuotaExhaustedError) void recordUsage(model, true);
    throw e;
  }
}

const inflight = new Map<string, Promise<string | undefined>>();

async function drawOnce(prompt: string, outFile: string, opts: DrawOpts): Promise<string | undefined> {
  if (await validImage(outFile)) return undefined;
  await rm(outFile, { force: true });
  const list = await imageRouting();
  let quota = 0;
  let last: unknown;
  for (const r of list) {
    try {
      const model = r.model || DEFAULT_IMAGE_MODEL[r.provider];
      if (r.provider === "codex") await codexDraw(prompt, outFile, model, opts);
      else if (r.provider === "gemini") await geminiImage(prompt, outFile, model, opts);
      else if (r.provider === "openai") await openaiImage(prompt, outFile, model, opts);
      else if (r.provider === "deepinfra") await deepinfraFlux(prompt, outFile, model, opts);
      else if (hasCloudflare()) await cloudflareFlux(prompt, outFile, r.model || CF_MODEL);
      else {
        await pollinations(prompt, outFile, opts);
        return "pollinations";
      }
      return r.provider === "cloudflare" ? r.model || CF_MODEL : model;
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
      if (res.ok && data) {
        await saveImage(outFile, Buffer.from(data, "base64"));
        void recordUsage(model, false);
        return;
      }
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
    void recordUsage(model, false);
  } catch (e) {
    if (e instanceof OpenAI.RateLimitError && /insufficient_quota|quota|billing/i.test(e.message)) {
      throw new QuotaExhaustedError(`OpenAI hết hạn mức vẽ ảnh: ${e.message}`);
    }
    throw e;
  }
}

/** Kích thước cho FLUX: bội số 64, tối đa ~1,3 MP (giá DeepInfra tính theo diện tích × số bước). */
export function fluxSize(o: DrawOpts) {
  const scale = Math.min(1, Math.sqrt((1280 * 1024) / (o.width * o.height)));
  const r64 = (n: number) => Math.max(256, Math.round((n * scale) / 64) * 64);
  return `${r64(o.width)}x${r64(o.height)}`;
}

/**
 * FLUX trên DeepInfra (API kiểu OpenAI, trả JPEG base64). Trả theo lượng dùng: $0.0005 × MP × số bước → ~0,002 USD/ảnh.
 * Hết tiền / thẻ lỗi (402) → QuotaExhaustedError để video chờ thay vì lỗi hẳn.
 */
async function deepinfraFlux(prompt: string, outFile: string, model: string, opts: DrawOpts) {
  let last = "";
  let size = fluxSize(opts);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://api.deepinfra.com/v1/openai/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.DEEPINFRA_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: prompt.slice(0, 2000), size, n: 1 }),
      signal: AbortSignal.timeout(120_000),
    }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
    if (res instanceof Error) {
      last = res.message;
    } else {
      const body = await res.json().catch(() => ({}));
      const data: string | undefined = body?.data?.[0]?.b64_json;
      if (res.ok && data) {
        await saveImage(outFile, Buffer.from(data, "base64"));
        void recordUsage(model, false);
        return;
      }
      last = `${res.status} ${JSON.stringify(body?.error ?? body?.detail ?? body).slice(0, 200)}`;
      if (res.status === 402 || /insufficient|balance|payment|billing/i.test(last)) {
        void recordUsage(model, true);
        throw new QuotaExhaustedError(`DeepInfra hết tiền / chưa thêm thẻ: ${last}`);
      }
      // Kích thước lạ bị từ chối → thử khung vuông chuẩn (ffmpeg tự cắt khung sau).
      if (res.status === 400 || res.status === 422) {
        if (size === "1024x1024") break;
        size = "1024x1024";
        continue;
      }
      if (res.status === 401 || res.status === 403) break;
    }
    await sleep(4_000 * (attempt + 1));
  }
  throw new Error(`DeepInfra vẽ ảnh lỗi: ${last}`);
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
        void recordUsage(model, false);
        return;
      }
      last = `${res.status} ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`;
      if (res.status === 429 && isDaily(last)) {
        void recordUsage(model, true);
        throw new QuotaExhaustedError("Hết quota ảnh Cloudflare — video chờ lượt sau.");
      }
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
