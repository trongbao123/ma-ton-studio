// Điều phối Kaggle (REST API v1, token KGAT_… kiểu Bearer): upload dataset ảnh → push kernel GPU → poll → tải clip về.
// Lỗi / timeout / không có GPU thì KHÔNG ném: trả `clips` rỗng + lý do để render dùng ảnh tĩnh như thường.
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { WEB_URL } from "@/lib/notify";
import { KAGGLE_GPU_USAGE_MODEL } from "@/lib/limits";
export { fetchKaggleGpuQuota as gpuQuota } from "@/lib/kaggle-quota";
import { buildManifest, datasetFiles, gpuMinutes, kaggleSlug, kernelFailureKind, kernelPhase, kernelPushBody, manifestJobs, parseClipLog, type ClipJob, type ClipResult, type KernelPhase } from "./i2v-plan";
import type { ModelProbe as ModelSpec } from "./i2v-sweep";
import { progressLine, type I2vProgressState } from "./i2v-progress";

const API = "https://www.kaggle.com/api/v1";
/** Tối đa chờ kernel (đẩy → xong), theo yêu cầu ≈ 60 phút. */
export const KERNEL_TIMEOUT_MINUTES = 60;
const POLL_MS = 20_000;
const DATASET_READY_TIMEOUT_MS = 5 * 60_000;
const SCRIPT_PATH = path.join(process.cwd(), "kaggle/i2v/run.py");

export type KaggleAuth = { username: string; token: string };

/** Token lấy từ env, KHÔNG bao giờ ghi vào log; thiếu thì null (bỏ qua clip động). */
export function kaggleAuth(env: NodeJS.ProcessEnv = process.env): KaggleAuth | null {
  const token = env.KAGGLE_API_TOKEN?.trim();
  const username = env.KAGGLE_USERNAME?.trim();
  return token && username ? { username, token } : null;
}

async function api<T>(auth: KaggleAuth, route: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${auth.token}`, ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kaggle ${route.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Upload 1 file thành blob, trả token để gắn vào dataset. */
async function uploadBlob(auth: KaggleAuth, file: string, name: string): Promise<string> {
  const bytes = await readFile(file);
  const start = await api<{ token: string; createUrl: string }>(auth, "blobs/upload", {
    method: "POST",
    body: JSON.stringify({ type: "dataset", name, contentLength: bytes.length, lastModifiedEpochSeconds: Math.floor((await stat(file)).mtimeMs / 1000) }),
  });
  const put = await fetch(start.createUrl, { method: "PUT", body: bytes, signal: AbortSignal.timeout(120_000) });
  if (!put.ok) throw new Error(`Upload blob ${name} lỗi ${put.status}`);
  return start.token;
}

/** Tạo dataset riêng tư từ các file; trả khi dataset đã sẵn sàng để kernel gắn vào. */
export async function createDataset(auth: KaggleAuth, o: { slug: string; title: string; files: { name: string; path: string }[] }): Promise<void> {
  const files: { token: string }[] = [];
  for (const f of o.files) files.push({ token: await uploadBlob(auth, f.path, f.name) });
  const created = await api<{ error?: string }>(auth, "datasets/create/new", {
    method: "POST",
    body: JSON.stringify({ ownerSlug: auth.username, slug: o.slug, title: o.title, licenseName: "CC0-1.0", isPrivate: true, files }),
  });
  if (created.error) throw new Error(`Tạo dataset lỗi: ${created.error}`);
  const deadline = Date.now() + DATASET_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    // Trả chuỗi JSON thuần ("ready"); 403 ngắn ngay sau khi tạo là bình thường (dữ liệu chưa đồng bộ).
    const status = await api<string | { status?: string }>(auth, `datasets/status/${auth.username}/${o.slug}`).catch(() => "");
    if ((typeof status === "string" ? status : (status.status ?? "")).toLowerCase() === "ready") return;
    await sleep(5000);
  }
  throw new Error("Dataset Kaggle không sẵn sàng sau 5 phút");
}

/** Xoá dataset tạm (giữ tài khoản gọn); lỗi bỏ qua. */
export async function deleteDataset(auth: KaggleAuth, slug: string): Promise<void> {
  await api(auth, `dataset/${auth.username}/${slug}/delete`, { method: "POST", body: "{}" }).catch(() => {});
}

export async function pushKernel(auth: KaggleAuth, o: { slug: string; title: string; datasetSlug: string; scriptPath?: string; timeoutMinutes?: number }): Promise<string> {
  const script = await readFile(o.scriptPath ?? SCRIPT_PATH, "utf8");
  const body = kernelPushBody({ username: auth.username, slug: o.slug, title: o.title, script, datasetSlug: o.datasetSlug, timeoutSeconds: (o.timeoutMinutes ?? KERNEL_TIMEOUT_MINUTES) * 60 });
  const res = await api<{ error?: string; ref?: string; invalidDatasetSources?: string[] }>(auth, "kernels/push", { method: "POST", body: JSON.stringify(body) });
  if (res.error || res.invalidDatasetSources?.length) throw new Error(`Push kernel lỗi: ${res.error ?? `dataset không hợp lệ ${res.invalidDatasetSources}`}`);
  return `https://www.kaggle.com/code/${auth.username}/${o.slug}`;
}

export async function kernelState(auth: KaggleAuth, slug: string): Promise<{ phase: KernelPhase; message: string }> {
  const s = await api<{ status: string; failureMessage?: string }>(auth, `kernels/status?userName=${auth.username}&kernelSlug=${slug}`);
  return { phase: kernelPhase(s.status), message: s.failureMessage ?? "" };
}

type KernelOutput = { files: { fileName: string; url: string }[]; log: string };

/** Log (nối các dòng stdout/stderr) + danh sách file output của kernel. */
export async function kernelOutput(auth: KaggleAuth, slug: string): Promise<KernelOutput> {
  const o = await api<{ files?: { fileName: string; url: string }[]; logNullable?: string; log?: string }>(auth, `kernels/output?userName=${auth.username}&kernelSlug=${slug}`);
  const raw = o.logNullable ?? o.log ?? "[]";
  let log = raw;
  try {
    log = (JSON.parse(raw) as { data: string }[]).map((l) => l.data).join("");
  } catch {
    /* log dạng text thô */
  }
  return { files: o.files ?? [], log };
}

export async function downloadTo(url: string, file: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Tải output lỗi ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** Cộng `seconds` giây GPU vào ai_usage (model "_kaggle_gpu", `calls` = số PHÚT) theo ngày UTC. */
export async function recordGpuUsage(seconds: number, day = new Date().toISOString().slice(0, 10)): Promise<void> {
  const minutes = gpuMinutes(seconds);
  if (!minutes || !process.env.DATABASE_URL) return;
  await db()
    .insert(aiUsage)
    .values({ day, model: KAGGLE_GPU_USAGE_MODEL, calls: minutes })
    .onConflictDoUpdate({ target: [aiUsage.day, aiUsage.model], set: { calls: sql`${aiUsage.calls} + ${minutes}` } })
    .catch((e) => console.warn("⚠ Không ghi được giờ GPU Kaggle:", e instanceof Error ? e.message : e));
}

/** Tổng phút GPU app đã ghi từ ngày `sinceDay` (UTC, yyyy-mm-dd). */
export async function gpuMinutesSince(sinceDay: string): Promise<number> {
  const rows = await db().select({ calls: aiUsage.calls }).from(aiUsage).where(and(eq(aiUsage.model, KAGGLE_GPU_USAGE_MODEL), sql`${aiUsage.day} >= ${sinceDay}`));
  return rows.reduce((n, r) => n + r.calls, 0);
}

export type I2vEvents = {
  /** Đổi giai đoạn: "upload" | "queued" | "running" | "download". */
  stage?: (stage: "upload" | "queued" | "running" | "download", detail?: string) => void;
  /** Kết quả từng clip đọc được từ log khi kernel còn chạy (Kaggle cho xem log dở). */
  partial?: (results: ClipResult[]) => void;
  /** Một clip tải về xong. */
  clip?: (r: ClipResult & { file: string }) => void;
  log?: (text: string) => void;
};

/** Phiên đã đẩy lên Kaggle, chờ lấy kết quả. */
export type I2vSession = { kernelSlug: string; datasetSlug: string; kernelUrl: string; startedAt: number; ids: number[] };

export type I2vOutcome = {
  /** id cảnh → file mp4 đã tải về. Rỗng khi lỗi. */
  clips: Map<number, string>;
  results: ClipResult[];
  /** Lý do không có clip (hoặc thiếu một phần); null = ổn. */
  reason: string | null;
  kernelUrl: string | null;
  model: string | null;
  gpuSeconds: number;
};

const empty = (reason: string, kernelUrl: string | null = null, gpuSeconds = 0): I2vOutcome => ({ clips: new Map(), results: [], reason, kernelUrl, model: null, gpuSeconds });

const FAILURE_TEXT = {
  "no-gpu": "Kaggle không cấp GPU (tài khoản cần xác minh số điện thoại) — dùng ảnh tĩnh",
  "no-internet": "Kaggle không cấp internet (cần xác minh số điện thoại) — dùng ảnh tĩnh",
} as const;

/** Lý do hiển thị khi kernel lỗi: thiếu GPU/internet có câu riêng, còn lại kèm thông báo của Kaggle. */
function failureText(kind: ReturnType<typeof kernelFailureKind>, message: string): string {
  if (kind !== "other") return FAILURE_TEXT[kind];
  return `Kernel Kaggle lỗi${message ? `: ${message.slice(0, 120)}` : ""} — dùng ảnh tĩnh`;
}

/** Bước 1: upload dataset (ảnh + manifest) và push kernel. Không ném — lỗi trả { error }. */
/**
 * Cấu hình để kernel POST tiến độ về app. Thiếu I2V_PROGRESS_TOKEN thì trả undefined —
 * kernel chạy y như cũ, chỉ là không có tiến độ trực tiếp (không phải lỗi).
 */
export function progressConfig(slug: string, videoId: number, total: number) {
  const token = process.env.I2V_PROGRESS_TOKEN?.trim();
  // Dùng WEB_URL dùng chung (đã có mặc định): Actions KHÔNG đặt biến WEB_URL, đọc thẳng process.env thì
  // tính năng im lặng không bao giờ chạy dù đã đặt token.
  return token ? { url: `${WEB_URL.replace(/\/$/, "")}/api/i2v/progress`, token, slug, videoId, total } : undefined;
}

/** Hỏi app xem kernel đang tới đâu (kernel tự báo về). Lỗi/chưa có thì null — chỉ là thông tin phụ. */
export async function fetchProgress(slug: string): Promise<I2vProgressState | null> {
  try {
    const res = await fetch(`${WEB_URL.replace(/\/$/, "")}/api/i2v/progress?slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? ((await res.json()) as I2vProgressState) : null;
  } catch {
    return null;
  }
}

export async function startI2v(o: { videoId: number; dir: string; jobs: (ClipJob & { file: string })[]; model?: ModelSpec; events?: I2vEvents }): Promise<{ session: I2vSession } | { error: string }> {
  const auth = kaggleAuth();
  if (!auth) return { error: "Thiếu KAGGLE_API_TOKEN / KAGGLE_USERNAME" };
  const stamp = Date.now();
  const datasetSlug = kaggleSlug("data", o.videoId, stamp);
  const kernelSlug = kaggleSlug("run", o.videoId, stamp);
  try {
    o.events?.stage?.("upload", `${o.jobs.length} ảnh`);
    const manifestFile = path.join(o.dir, `i2v-manifest-${stamp}.json`);
    await writeFile(manifestFile, JSON.stringify(buildManifest(manifestJobs(o.jobs), 42, o.model, progressConfig(kernelSlug, o.videoId, o.jobs.length))));
    await createDataset(auth, {
      slug: datasetSlug,
      title: datasetSlug,
      files: datasetFiles({ name: "manifest.json", path: manifestFile }, o.jobs),
    });
    const kernelUrl = await pushKernel(auth, { slug: kernelSlug, title: kernelSlug, datasetSlug });
    o.events?.stage?.("queued", kernelUrl);
    return { session: { kernelSlug, datasetSlug, kernelUrl, startedAt: Date.now(), ids: o.jobs.map((j) => j.id) } };
  } catch (e) {
    await deleteDataset(auth, datasetSlug);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Bước 2: chờ kernel xong (tối đa `deadline` ms epoch), tải clip về `dir`, ghi giờ GPU. Không ném.
 * Hết hạn / lỗi / thiếu GPU → `clips` rỗng (hoặc chỉ những clip đã xong) kèm `reason`.
 */
export async function finishI2v(o: { session: I2vSession; dir: string; deadline: number; prefix?: string; events?: I2vEvents }): Promise<I2vOutcome> {
  const auth = kaggleAuth();
  const { session } = o;
  if (!auth) return empty("Thiếu KAGGLE_API_TOKEN / KAGGLE_USERNAME");
  const ev = o.events;
  try {
    let phase: KernelPhase = "queued";
    let message = "";
    let lastPhase: KernelPhase | null = null;
    let lastLive: string | null = null;
    while (Date.now() < o.deadline) {
      ({ phase, message } = await kernelState(auth, session.kernelSlug).catch(() => ({ phase: "queued" as KernelPhase, message: "" })));
      if (phase !== lastPhase && (phase === "queued" || phase === "running")) ev?.stage?.(phase, phase);
      lastPhase = phase;
      if (phase === "done" || phase === "failed") break;
      if (phase === "running" && ev?.partial) await kernelOutput(auth, session.kernelSlug).then((out) => ev.partial?.(parseClipLog(out.log)), () => {});
      // Log Kaggle rỗng cho tới khi kernel xong, nên tiến độ trong lúc chạy chỉ có từ đường kernel tự báo về.
      if (phase === "running") {
        const live = await fetchProgress(session.kernelSlug);
        const line = live ? progressLine(live) : null;
        if (line && line !== lastLive) {
          lastLive = line;
          ev?.log?.(line);
        }
      }
      await sleep(POLL_MS);
    }
    const gpuSeconds = Math.round((Date.now() - session.startedAt) / 1000);
    if (phase !== "done" && phase !== "failed") return empty(`Kaggle quá hạn chờ (${KERNEL_TIMEOUT_MINUTES} phút) — dùng ảnh tĩnh`, session.kernelUrl, gpuSeconds);

    const out = await kernelOutput(auth, session.kernelSlug);
    const results = parseClipLog(out.log);
    if (phase === "failed" && !results.some((r) => r.ok)) {
      await recordGpuUsage(gpuSeconds);
      return empty(failureText(kernelFailureKind(out.log), message), session.kernelUrl, gpuSeconds);
    }

    ev?.stage?.("download");
    const clips = new Map<number, string>();
    for (const r of results.filter((x) => x.ok)) {
      const remote = out.files.find((f) => f.fileName === `clip-${r.id}.mp4`);
      if (!remote) continue;
      const file = path.join(o.dir, `${o.prefix ?? "i2v"}-clip-${r.id}.mp4`);
      await downloadTo(remote.url, file);
      clips.set(r.id, file);
      ev?.clip?.({ ...r, file });
    }
    const model = await modelOf(out);
    await recordGpuUsage(gpuSeconds);
    const missing = session.ids.length - clips.size;
    return { clips, results, reason: missing ? `${missing}/${session.ids.length} clip không tạo được — cảnh đó dùng ảnh tĩnh` : null, kernelUrl: session.kernelUrl, model, gpuSeconds };
  } catch (e) {
    return empty(`Lỗi Kaggle: ${e instanceof Error ? e.message : e}`, session.kernelUrl);
  } finally {
    await deleteDataset(auth, session.datasetSlug);
  }
}

/** Tên model/GPU từ results.json của kernel (nếu đã được liệt kê trong output). */
async function modelOf(out: KernelOutput): Promise<string | null> {
  const f = out.files.find((x) => x.fileName === "results.json");
  if (!f) return null;
  try {
    const j = (await (await fetch(f.url, { signal: AbortSignal.timeout(30_000) })).json()) as { model?: string; gpu?: string };
    return [j.model, j.gpu].filter(Boolean).join(" · ") || null;
  } catch {
    return null;
  }
}

/** Đẩy + chờ + tải trong một lần (CLI kaggle-test). */
export async function runI2v(o: { videoId: number; dir: string; jobs: (ClipJob & { file: string })[]; model?: ModelSpec; events?: I2vEvents }): Promise<I2vOutcome> {
  const started = await startI2v(o);
  if ("error" in started) return empty(started.error);
  return finishI2v({ session: started.session, dir: o.dir, deadline: started.session.startedAt + KERNEL_TIMEOUT_MINUTES * 60_000, events: o.events });
}
