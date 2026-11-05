import { writeFile } from "node:fs/promises";

/**
 * Ảnh free từ Pollinations (Flux). Bản không token có logo nhỏ ở góc dưới — render sẽ cắt bỏ.
 * Có POLLINATIONS_TOKEN (đăng ký free) thì hết logo và ít bị giới hạn hơn.
 */
export async function drawImage(prompt: string, outFile: string, opts: { width: number; height: number; seed: number }) {
  const url = new URL(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}`);
  url.searchParams.set("width", String(opts.width));
  url.searchParams.set("height", String(opts.height));
  url.searchParams.set("seed", String(opts.seed));
  url.searchParams.set("nologo", "true");
  url.searchParams.set("model", "flux");
  const headers: Record<string, string> = {};
  if (process.env.POLLINATIONS_TOKEN) headers.Authorization = `Bearer ${process.env.POLLINATIONS_TOKEN}`;

  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(120_000) });
      const type = res.headers.get("content-type") ?? "";
      if (res.ok && type.startsWith("image/")) {
        await writeFile(outFile, Buffer.from(await res.arrayBuffer()));
        return;
      }
      last = `${res.status} ${type}`;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 8_000 * (attempt + 1)));
  }
  throw new Error(`Tạo ảnh lỗi: ${last}`);
}
