import { readFile, rm, writeFile } from "node:fs/promises";
import { QuotaExhaustedError } from "@/lib/ai";

/** Pollinations free không key: 1 ảnh / 45 giây / IP → xếp hàng tuần tự. Chỉ dùng khi không cấu hình Cloudflare. */
const GAP_MS = process.env.POLLINATIONS_TOKEN ? 0 : 46_000;
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CF_MODEL = process.env.CF_IMAGE_MODEL ?? "@cf/black-forest-labs/flux-1-schnell";
const cfUrl = () => `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${CF_MODEL}`;
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

/**
 * Vẽ 1 ảnh. Có Cloudflare thì CHỈ dùng Cloudflare: hết quota ngày → QuotaExhaustedError để video chờ lượt sau
 * (ảnh đã vẽ được cache), không chèn ảnh Pollinations free xấu vào giữa video.
 */
export async function drawImage(prompt: string, outFile: string, opts: { width: number; height: number; seed: number }) {
  if (await validImage(outFile)) return;
  await rm(outFile, { force: true });
  return hasCloudflare() ? cloudflareFlux(prompt, outFile) : pollinations(prompt, outFile, opts);
}

/** Flux trên Cloudflare Workers AI: ảnh vuông 1024×1024, free 10k neuron/ngày (~1 video). */
async function cloudflareFlux(prompt: string, outFile: string) {
  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(cfUrl(), {
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
