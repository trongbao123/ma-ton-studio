import { access, writeFile } from "node:fs/promises";

/** Bản free không key: 1 ảnh / 45 giây / IP → xếp hàng tuần tự, có key thì bỏ giãn cách. */
const GAP_MS = process.env.POLLINATIONS_TOKEN ? 0 : 46_000;
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ảnh free từ Pollinations. Bản không key có logo nhỏ ở góc dưới — render sẽ cắt bỏ.
 * Có POLLINATIONS_TOKEN (đăng ký free ở enter.pollinations.ai) thì hết logo và không phải chờ.
 */
export function drawImage(prompt: string, outFile: string, opts: { width: number; height: number; seed: number }) {
  // Có Cloudflare thì dùng Flux (đẹp hơn hẳn); Pollinations free (model Sana) chỉ là dự phòng.
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
    return cloudflareFlux(prompt, outFile).catch((e) => {
      console.warn("⚠ Cloudflare lỗi, chuyển Pollinations:", e instanceof Error ? e.message : e);
      return pollinations(prompt, outFile, opts);
    });
  }
  return pollinations(prompt, outFile, opts);
}

/** Flux-1-schnell trên Cloudflare Workers AI: ảnh vuông 1024×1024 (không nhận seed/kích thước), free ~10k neuron/ngày. */
async function cloudflareFlux(prompt: string, outFile: string) {
  if (await access(outFile).then(() => true, () => false)) return;
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`;
  let last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 8 }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await res.json().catch(() => ({}));
    const image = body?.result?.image;
    if (res.ok && image) {
      await writeFile(outFile, Buffer.from(image, "base64"));
      return;
    }
    last = `${res.status} ${JSON.stringify(body?.errors ?? body).slice(0, 200)}`;
    if (res.status === 429 && /daily|neuron|limit/i.test(last)) break;
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
  if (await access(outFile).then(() => true, () => false)) return;
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
        await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
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
