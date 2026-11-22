// Cảnh địa hình 3D: Blender dựng mặt đất theo độ cao thật, mũi tên hành quân 3D, máy quay bay — render trên Kaggle GPU.
// Hết giờ GPU / lỗi / quá ngân sách thì trả false để bên gọi lùi cảnh đó về bản đồ 2D (video vẫn đủ độ dài).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import type { GeoPoint } from "@/lib/story/geocode";
import type { Shot } from "@/lib/story/storyboard";
import { boxFor, loadShapes, pathData, projector } from "./geo-base";
import { createDataset, deleteDataset, downloadTo, kaggleAuth, kernelOutput, kernelState, pushKernel, recordGpuUsage } from "./kaggle";

/** Mỗi video chỉ 2–4 cảnh đắt giá được render 3D (Kaggle ~30 giờ GPU/tuần, dùng chung với việc khác). */
export const TERRAIN_MAX_SECONDS_PER_VIDEO = 240;
export const TERRAIN_FPS = 25;
/** Texture bản đồ đắp lên mặt địa hình. */
const TEXTURE_W = 4096;
const ASPECT = 16 / 9;

/** Ngân sách giây 3D cho một video. */
export type TerrainBudget = { take(seconds: number): boolean; used(): number };

/** Bộ đếm giây 3D đã dùng; `take` trả false khi vượt trần. */
export function terrainBudget(limit = TERRAIN_MAX_SECONDS_PER_VIDEO): TerrainBudget {
  let spent = 0;
  return {
    take(seconds) {
      if (spent + seconds > limit) return false;
      spent += seconds;
      return true;
    },
    used: () => spent,
  };
}

/** Việc gửi sang Kaggle: đẩy dataset + chạy kernel Blender + tải khung hình về `framesDir`. */
export type KaggleTerrainJob = (o: { dir: string; framesDir: string; shot: Shot }) => Promise<void>;

export type TerrainRun = {
  shot: Shot;
  places: Map<string, GeoPoint>;
  dir: string;
  out: string;
  budget: TerrainBudget;
  runOnKaggle: KaggleTerrainJob;
};

/** Texture bản đồ (đất, sông, biển) để Blender đắp lên mặt địa hình. */
async function writeTexture(points: GeoPoint[], dir: string) {
  const box = boxFor(points, ASPECT);
  const height = Math.round((TEXTURE_W * (box.n - box.s)) / ((box.e - box.w) * Math.cos((((box.s + box.n) / 2) * Math.PI) / 180)));
  const project = projector(box, TEXTURE_W, height);
  const shapes = await loadShapes(box);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TEXTURE_W}" height="${height}">
<rect width="${TEXTURE_W}" height="${height}" fill="#1c3a4d"/>
<g fill="#cdb47c">${shapes.land.map((r) => `<path d="${pathData(r, project, true)}"/>`).join("")}</g>
<g fill="none" stroke="#2c6f9c" stroke-width="16" stroke-linecap="round">${shapes.rivers.map((r) => `<path d="${pathData(r, project, false)}"/>`).join("")}</g>
<g fill="none" stroke="#6b5530" stroke-width="5">${shapes.coast.map((r) => `<path d="${pathData(r, project, false)}"/>`).join("")}</g>
</svg>`;
  await writeFile(path.join(dir, "texture.png"), new Resvg(svg).render().asPng());
  return { box, textureHeight: height };
}

/**
 * Dựng một cảnh địa hình 3D. Trả `true` khi ra được file; `false` khi không làm được (hết ngân sách, thiếu toạ độ,
 * Kaggle lỗi/hết giờ) — bên gọi lùi cảnh đó về bản đồ 2D.
 */
export async function renderTerrainScene({ shot, places, dir, out, budget, runOnKaggle }: TerrainRun): Promise<boolean> {
  const names = shot.route ?? shot.places ?? [];
  const points = names.map((n) => places.get(n)).filter((p): p is GeoPoint => p != null);
  if (points.length < 2) {
    console.warn(`⚠ Cảnh 3D thiếu toạ độ (${names.join(", ")}) — lùi về bản đồ 2D`);
    return false;
  }
  const seconds = Math.max(1, shot.end - shot.start);
  if (!budget.take(seconds)) {
    console.log(`• Hết ngân sách cảnh 3D (${budget.used()}/${TERRAIN_MAX_SECONDS_PER_VIDEO} giây) — cảnh này dùng bản đồ 2D`);
    return false;
  }
  try {
    await mkdir(dir, { recursive: true });
    const { box, textureHeight } = await writeTexture(points, dir);
    const route = names.flatMap((name) => {
      const point = places.get(name);
      return point ? [{ name: name.split(",")[0].trim(), lat: point.lat, lon: point.lon, battle: (shot.battles ?? []).includes(name) }] : [];
    });
    await writeFile(
      path.join(dir, "config.json"),
      JSON.stringify({ bbox: box, textureW: TEXTURE_W, textureH: textureHeight, route, seconds, fps: TERRAIN_FPS, camera: shot.camera, title: shot.title ?? "" }, null, 1),
    );
    const framesDir = path.join(dir, "frames");
    await mkdir(framesDir, { recursive: true });
    await runOnKaggle({ dir, framesDir, shot });
    const { ffmpeg } = await import("./ffmpeg");
    await ffmpeg(["-framerate", String(TERRAIN_FPS), "-i", path.join(framesDir, "f%05d.png"), "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", out]);
    return true;
  } catch (e) {
    console.warn("⚠ Cảnh 3D lỗi — lùi về bản đồ 2D:", e instanceof Error ? e.message : e);
    return false;
  }
}

/** Chờ kernel Blender tối đa ngần này phút (cài Blender ~2 phút + render). */
const KAGGLE_MAX_WAIT_MINUTES = 55;
const POLL_MS = 20_000;
const MS_PER_MINUTE = 60_000;
const SECONDS_PER_MINUTE = 60;

/** Việc gửi Kaggle thật: đẩy dataset (config + texture + font + script), chạy kernel, tải khung hình về. */
export function kaggleTerrainJob({ videoId, log }: { videoId: number; log: (text: string) => void }): KaggleTerrainJob {
  return async ({ dir, framesDir }) => {
    const auth = kaggleAuth();
    if (!auth) throw new Error("Chưa cấu hình Kaggle (KAGGLE_USERNAME / KAGGLE_API_TOKEN) — không render được cảnh 3D");
    const stamp = Date.now().toString(36);
    const dataset = `mts-terr-data-${videoId}-${stamp}`;
    const slug = `mts-terr-run-${videoId}-${stamp}`;
    await createDataset(auth, {
      slug: dataset,
      title: dataset,
      files: [
        { name: "config.json", path: path.join(dir, "config.json") },
        { name: "texture.png", path: path.join(dir, "texture.png") },
        { name: "scene.py", path: path.resolve("kaggle/terrain/scene.py") },
        { name: "BeVietnamPro-Bold.ttf", path: path.resolve("pipeline/fonts/BeVietnamPro-Bold.ttf") },
      ],
    });
    const url = await pushKernel(auth, { slug, title: slug, datasetSlug: dataset, scriptPath: path.resolve("kaggle/terrain/run.py") });
    log(`Cảnh 3D giao Kaggle — ${url}`);
    const startedAt = Date.now();
    const deadline = startedAt + KAGGLE_MAX_WAIT_MINUTES * MS_PER_MINUTE;
    let phase = "queued";
    while (Date.now() < deadline) {
      phase = (await kernelState(auth, slug).catch(() => ({ phase: "queued" as const }))).phase;
      if (phase === "done" || phase === "failed") break;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    try {
      if (phase !== "done") throw new Error(`Kernel 3D ${phase === "failed" ? "lỗi" : `quá ${KAGGLE_MAX_WAIT_MINUTES} phút`}`);
      const out = await kernelOutput(auth, slug);
      const frames = out.files.filter((f) => /\.png$/.test(f.fileName));
      if (!frames.length) throw new Error(`Kernel 3D không trả khung hình nào: ${out.log.slice(-400)}`);
      for (const f of frames) await downloadTo(f.url, path.join(framesDir, path.basename(f.fileName)));
      void recordGpuUsage(Math.round((Date.now() - startedAt) / 1000 / SECONDS_PER_MINUTE) * SECONDS_PER_MINUTE);
      log(`Cảnh 3D xong: ${frames.length} khung`);
    } finally {
      void deleteDataset(auth, dataset);
    }
  };
}
