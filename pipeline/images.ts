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

  let last = "";
  for (let attempt = 0; attempt < 8; attempt++) {
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
      else await sleep(10_000 * (attempt + 1));
    } catch (e) {
      last = String(e);
      await sleep(10_000);
    }
  }
  throw new Error(`Tạo ảnh lỗi: ${last}`);
}
