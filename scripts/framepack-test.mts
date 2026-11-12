// Thử FramePack F1 trên Kaggle T4 với 2 ảnh trong /tmp/i2v-in → /tmp/framepack/clip-*.mp4. CLI: pnpm exec tsx scripts/framepack-test.mts
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDataset, deleteDataset, downloadTo, kaggleAuth, kernelOutput, kernelState, pushKernel } from "../pipeline/kaggle";

const auth = kaggleAuth();
if (!auth) throw new Error("thiếu KAGGLE_*");
const dir = "/tmp/framepack";
await mkdir(dir, { recursive: true });
const clips = [
  { id: 0, src: "/tmp/i2v-in/long-img-10.jpg", prompt: "The young swordsman throws a powerful punch into the ancient stone stele, his body twisting with force, golden qi exploding from his fist, cracks spreading across the glowing runes, debris flying, hair and red-white robes whipping, 3D donghua animation, smooth fluid motion" },
  { id: 1, src: "/tmp/i2v-in/long-img-1.jpg", prompt: "The hooded young man slowly lowers his hand from his mouth and turns his head toward the viewer with cold glowing eyes, purple demonic aura rising around him, the stout official behind him frowns and grips his staff, candle flames flickering, 3D donghua animation, smooth fluid motion" },
];
for (const c of clips) await copyFile(c.src, path.join(dir, `in-${c.id}.jpg`));
const manifest = { width: 640, height: 384, frames: 61, steps: 25, fps: 30, clips: clips.map((c) => ({ id: c.id, image: `in-${c.id}.jpg`, prompt: c.prompt })) };
await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
const stamp = Date.now().toString(36);
const ds = `mts-fp-data-${stamp}`, kslug = `mts-fp-run-${stamp}`;
const t0 = Date.now();
const lap = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
await createDataset(auth, { slug: ds, title: ds, files: ["manifest.json", "in-0.jpg", "in-1.jpg"].map((n) => ({ name: n, path: path.join(dir, n) })) });
lap(`kernel ${await pushKernel(auth, { slug: kslug, title: kslug, datasetSlug: ds, scriptPath: "kaggle/framepack/run.py", timeoutMinutes: 180 })}`);
for (;;) {
  await new Promise((r) => setTimeout(r, 30_000));
  const s = await kernelState(auth, kslug).catch(() => null);
  if (s && (s.phase === "done" || s.phase === "failed")) { lap(`${s.phase} ${s.message}`); break; }
}
const out = await kernelOutput(auth, kslug);
console.log(out.log.split("\n").filter((l) => /MTS_|^\[\s*\d|Error|error/.test(l)).slice(-40).join("\n"));
for (const f of out.files) if (/\.(mp4|json)$/.test(f.fileName)) await downloadTo(f.url, path.join(dir, path.basename(f.fileName)));
await deleteDataset(auth, ds);
lap("xong");
