// Thử Z-Image-Turbo trên Kaggle: 4 prompt style kênh → /tmp/zimage/img-*.png. CLI: pnpm exec tsx scripts/zimage-test.mts [fp16-vae32|bf16]
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDataset, deleteDataset, downloadTo, kaggleAuth, kernelOutput, kernelState, pushKernel } from "../pipeline/kaggle";
import { ART_STYLE as STYLE } from "../pipeline/prompts";

const mode = process.argv[2];
const scenes = [
  "a handsome young man in an ornate black and purple hooded hanfu with gold embroidery covering his mouth with one hand, a small purple shadow creature with glowing eyes on his shoulder, behind him a stout middle-aged official in bronze armor leaning on a staff, candle in foreground, dark palace hall, floating mountains visible through the window",
  "a young swordsman in white and crimson robes punching a giant ancient stone stele covered in glowing red runes, cracks spreading, golden qi swirling around his fist, debris flying, sea of clouds and floating immortal palaces behind",
  "a beautiful female cultivator in flowing azure hanfu standing on a cliff edge at dawn, long black hair blowing, holding a jade flute, golden sunrise over a sea of clouds",
  "two elders in grey robes facing each other in a ruined sect courtyard at night, lightning in the storm clouds above, one raising a palm glowing with blue energy",
];
const auth = kaggleAuth();
if (!auth) throw new Error("thiếu KAGGLE_*");
const dir = "/tmp/zimage";
await mkdir(dir, { recursive: true });
const manifest = { width: 1024, height: 576, steps: 9, seed: 42, ...(mode ? { mode } : {}), images: scenes.map((s, id) => ({ id, prompt: `${STYLE}. ${s}` })) };
await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
const stamp = Date.now().toString(36);
const ds = `mts-zimg-data-${stamp}`, kslug = `mts-zimg-run-${stamp}`;
const t0 = Date.now();
const lap = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
await createDataset(auth, { slug: ds, title: ds, files: [{ name: "manifest.json", path: path.join(dir, "manifest.json") }] });
lap(`kernel ${await pushKernel(auth, { slug: kslug, title: kslug, datasetSlug: ds, scriptPath: "kaggle/zimage/run.py" })}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 20_000));
  const s = await kernelState(auth, kslug).catch(() => null);
  if (!s) continue;
  if (s.phase === "done" || s.phase === "failed") { lap(`${s.phase} ${s.message}`); break; }
}
const out = await kernelOutput(auth, kslug);
console.log(out.log.split("\n").filter((l) => /MTS_|\[\s*\d/.test(l)).join("\n"));
for (const f of out.files) if (/\.(png|json)$/.test(f.fileName)) await downloadTo(f.url, path.join(dir, path.basename(f.fileName)));
await deleteDataset(auth, ds);
lap("xong");
