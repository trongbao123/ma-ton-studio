import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { fetchClaudeLimits } from "@/lib/ai/claude-limits";
import { toLimitWindow, type PlanSnapshot } from "@/lib/ai/plan-limits";
import { loadPlanLimits, savePlanLimits } from "@/lib/ai/plan-limits-store";
import { bySource, classifyModel, DAILY_LIMIT, nextPacificMidnight, nextReset, type SourceDay } from "@/lib/ai/sources";
import { quotaDay } from "@/lib/ai/usage";
import {
  CF_DAILY_NEURONS,
  cfNeuronsOf,
  geminiDailyLimit,
  GH_MONTHLY_MINUTES,
  KAGGLE_GPU_USAGE_MODEL,
  KAGGLE_WEEKLY_GPU_MINUTES,
  nextMonthStart,
  percentUsed,
  YT_DAILY_UNITS,
  YT_USAGE_MODEL,
  type LimitRow,
  type LimitWindow,
} from "@/lib/limits";
import { fetchKaggleGpuQuota, kaggleWeekStartDay, nextKaggleReset } from "@/lib/kaggle-quota";
import { loadSecrets } from "@/lib/secrets";
import { vidiqBalance } from "@/lib/vidiq-balance";

const CACHE_MS = 5 * 60_000;
let cache: { at: number; rows: LimitRow[] } | null = null;

const makeWindow = (label: string, used: number | null, total: number | null, unit: string, resetsAt: Date | null): LimitWindow => ({
  label,
  used,
  total,
  percent: percentUsed(used, total),
  unit,
  resetsAt: resetsAt?.toISOString() ?? null,
});

type TodayUsage = { sources: Partial<Record<string, SourceDay>>; ytUnits: number };

async function todayUsage(): Promise<TodayUsage> {
  const rows = await db().select().from(aiUsage).where(eq(aiUsage.day, quotaDay()));
  return { sources: bySource(rows), ytUnits: rows.find((r) => r.model === YT_USAGE_MODEL)?.calls ?? 0 };
}

const snapshotRow = (row: Pick<LimitRow, "id" | "name" | "brand">, snap: PlanSnapshot | undefined, missing: string): LimitRow =>
  snap
    ? { ...row, source: "api", windows: snap.windows.map(toLimitWindow), note: snap.plan ? `Gói ${snap.plan}` : null, asOf: snap.at }
    : { ...row, source: "none", windows: [], note: missing, asOf: null };

async function claudeRow(): Promise<LimitRow> {
  const row = { id: "claude-plan", name: "Claude · gói Pro", brand: "claude" as const };
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const saved = (await loadPlanLimits()).claude;
  if (!token) return snapshotRow(row, saved, "Chưa kết nối gói Claude.");
  const windows = await fetchClaudeLimits(token);
  if (!windows.length) return snapshotRow(row, saved, "Token không đọc được hạn mức (cần quyền user:profile) — Anthropic không có đường khác.");
  const snap: PlanSnapshot = { windows, plan: null, at: new Date().toISOString() };
  void savePlanLimits("claude", snap);
  return snapshotRow(row, snap, "");
}

const chatgptRow = async (): Promise<LimitRow> =>
  snapshotRow({ id: "chatgpt-plan", name: "ChatGPT · gói Plus (Codex)", brand: "openai" }, (await loadPlanLimits()).codex, "Chưa có số đo — hiện sau lần Codex chạy kế tiếp trên GitHub Actions.");

/**
 * Vẽ ảnh bằng gói ChatGPT Plus (Codex): lượt vẽ ảnh RIÊNG của gói, không dính Cloudflare. OpenAI không công bố số lượt
 * và API hạn mức của Codex chỉ trả khung chung của gói → hiện số ảnh app đã vẽ hôm nay; mốc = số ảnh của lần gần nhất
 * chạm giới hạn (7 ngày qua), như cách đo của Gemini.
 */
async function chatgptImageRow(today: TodayUsage): Promise<LimitRow> {
  const row = { id: "chatgpt-image", name: "Vẽ ảnh · gói ChatGPT Plus", brand: "openai" as const, asOf: null };
  const day = today.sources["chatgpt-image"];
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const recent = await db().select().from(aiUsage).where(gte(aiUsage.day, since));
  const hits = new Map<string, number>();
  for (const r of recent) {
    if (classifyModel(r.model) !== "chatgpt-image") continue;
    hits.set(r.day, (hits.get(r.day) ?? 0) + r.calls);
  }
  const limitedDays = [...new Set(recent.filter((r) => r.limited && classifyModel(r.model) === "chatgpt-image").map((r) => r.day))].sort();
  const lastHit = limitedDays.at(-1);
  const measured = lastHit ? (hits.get(lastHit) ?? null) : null;
  const used = day?.calls ?? 0;
  const w = makeWindow("Hôm nay", used, measured, "ảnh", null);
  const note = day?.limited
    ? "Đã chạm giới hạn vẽ ảnh của gói hôm nay — app tự chuyển sang AI vẽ kế tiếp (Cloudflare)."
    : measured
      ? `Mốc ~${measured} ảnh là số đo được lần chạm giới hạn gần nhất (${lastHit}). OpenAI không công bố số lượt của gói Plus.`
      : "OpenAI không công bố số lượt vẽ ảnh của gói Plus — mốc sẽ hiện sau lần đầu chạm giới hạn.";
  return { ...row, source: "measured", windows: [day?.limited ? { ...w, percent: 100 } : w], note };
}

/** Gemini: Google không có API đọc quota còn lại → số lượt app đếm hôm nay so với mốc free đã đo, tính theo từng model. */
function geminiRow(id: "gemini-free" | "voice", name: string, today: TodayUsage): LimitRow {
  const reset = nextReset(id);
  const day = today.sources[id];
  const windows = (day?.models ?? []).map((m) => {
    const w = makeWindow(m.model, m.calls, geminiDailyLimit(m.model), "lượt", reset);
    return m.limited ? { ...w, percent: 100 } : w;
  });
  if (!windows.length) windows.push(makeWindow("Hôm nay", 0, DAILY_LIMIT[id] ?? null, "lượt", reset));
  return { id, name, brand: "gemini", source: "measured", windows, note: "Google không công bố quota còn lại; mốc là số đã đo được khi chạm giới hạn.", asOf: null };
}

async function cloudflareNeurons(): Promise<number | null> {
  const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
  if (!token || !account) return null;
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())).toISOString();
  const query = `query($acc:String!,$since:Time!){viewer{accounts(filter:{accountTag:$acc}){aiInferenceAdaptiveGroups(limit:100,filter:{datetimeHour_geq:$since}){sum{totalNeurons}}}}}`;
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { acc: account, since } }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await res.json()) as { data?: { viewer?: { accounts?: { aiInferenceAdaptiveGroups?: { sum?: { totalNeurons?: number } }[] }[] } } | null };
  const groups = j.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups;
  if (!groups) return null;
  return Math.round(groups.reduce((n, g) => n + (g.sum?.totalNeurons ?? 0), 0));
}

/** Cloudflare: GraphQL Analytics nếu token có quyền; không thì ước tính từ số ảnh app đã vẽ × neuron/ảnh. */
async function cloudflareRow(today: TodayUsage): Promise<LimitRow> {
  const row = { id: "cloudflare", name: "Cloudflare Workers AI", brand: "cloudflare" as const, asOf: null };
  const reset = nextReset("cloudflare");
  const real = await cloudflareNeurons().catch(() => null);
  if (real != null) return { ...row, source: "api", windows: [makeWindow("Hôm nay", real, CF_DAILY_NEURONS, "neuron", reset)], note: null };
  const images = today.sources.cloudflare?.calls ?? 0;
  return {
    ...row,
    source: "estimate",
    windows: [makeWindow("Hôm nay", cfNeuronsOf(images), CF_DAILY_NEURONS, "neuron", reset)],
    note: `${images} ảnh × ~59 neuron/ảnh (bảng giá FLUX-1-schnell 1024², 4 bước). Token chưa có quyền Analytics Read nên không đọc được số thật.`,
  };
}

async function vidiqRow(): Promise<LimitRow> {
  const row = { id: "vidiq", name: "vidIQ", brand: "vidiq" as const, asOf: null };
  const b = await vidiqBalance();
  if (!b || (b.remaining == null && b.used == null)) return { ...row, source: "none", windows: [], note: "Chưa đọc được số dư vidIQ (chưa có key hoặc vidIQ không trả lời)." };
  const used = b.used ?? (b.total != null && b.remaining != null ? b.total - b.remaining : null);
  const reset = b.resetAt && !Number.isNaN(new Date(b.resetAt).getTime()) ? new Date(b.resetAt) : null;
  return { ...row, source: "api", windows: [makeWindow("Credit", used, b.total, "credit", reset)], note: b.plan ? `Gói ${b.plan}` : null };
}

function youtubeRow(today: TodayUsage): LimitRow {
  return {
    id: "youtube",
    name: "YouTube Data API",
    brand: "youtube",
    source: "measured",
    windows: [makeWindow("Hôm nay", today.ytUnits, YT_DAILY_UNITS, "unit", nextPacificMidnight())],
    note: "App tự cộng unit mỗi lệnh gọi (upload 1600, thumbnail/sửa video/playlist 50). Google không có API đọc quota — Cloud Console có thể cao hơn nếu có công cụ khác dùng chung.",
    asOf: null,
  };
}

type Run = { run_started_at?: string; updated_at?: string; status?: string };

/** GitHub Actions: API billing (cần PAT scope `user`); không được thì cộng thời lượng các run trong tháng. */
async function githubRow(): Promise<LimitRow> {
  const row = { id: "github", name: "GitHub Actions", brand: "github" as const, asOf: null };
  const { GH_TOKEN: token, GH_REPO: repo } = process.env;
  const reset = nextMonthStart();
  if (!token || !repo) return { ...row, source: "none", windows: [], note: "Thiếu GH_TOKEN / GH_REPO trên Vercel." };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const now = new Date();
  const billing = await fetch(`https://api.github.com/users/${repo.split("/")[0]}/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (billing?.ok) {
    const j = (await billing.json()) as { usageItems?: { product?: string; unitType?: string; quantity?: number }[] };
    const minutes = (j.usageItems ?? []).filter((i) => i.product === "actions" && /minute/i.test(i.unitType ?? "")).reduce((n, i) => n + (i.quantity ?? 0), 0);
    return { ...row, source: "api", windows: [makeWindow("Tháng này", Math.round(minutes), GH_MONTHLY_MINUTES, "phút", reset)], note: null };
  }
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  let ms = 0;
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs?created=%3E%3D${month}&per_page=100&page=${page}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const runs = ((await res.json()) as { workflow_runs?: Run[] }).workflow_runs ?? [];
    for (const r of runs) if (r.status === "completed" && r.run_started_at && r.updated_at) ms += new Date(r.updated_at).getTime() - new Date(r.run_started_at).getTime();
    if (runs.length < 100) break;
  }
  return {
    ...row,
    source: "estimate",
    windows: [makeWindow("Tháng này", Math.round(ms / 60_000), GH_MONTHLY_MINUTES, "phút", reset)],
    note: "Cộng thời lượng các run đã xong trong tháng (GitHub làm tròn lên từng job nên số thật cao hơn chút). API billing cần token có scope user.",
  };
}

const KAGGLE_WEEKLY_HOURS = KAGGLE_WEEKLY_GPU_MINUTES / 60;
const hoursOf = (seconds: number) => Math.round(seconds / 360) / 10;

/** Kaggle GPU free: số thật từ API `/kernels/quota` (30 giờ/tuần); không đọc được thì cộng phút GPU app đã ghi (ai_usage "_kaggle_gpu") trong tuần — ước tính. */
async function kaggleRow(): Promise<LimitRow> {
  const row = { id: "kaggle", name: "Kaggle GPU (clip động)", brand: "kaggle" as const, asOf: null };
  const real = await fetchKaggleGpuQuota();
  if (real) {
    const used = hoursOf(real.usedSeconds);
    const note = real.hasEverRun ? null : "Kaggle chưa từng cấp GPU cho tài khoản này — cần xác minh số điện thoại (kernel chạy không có GPU/internet).";
    return { ...row, source: "api", windows: [makeWindow("Tuần này", used, hoursOf(real.totalSeconds), "giờ", new Date(real.refreshAt))], note };
  }
  const reset = nextKaggleReset();
  const rows = await db().select({ calls: aiUsage.calls }).from(aiUsage).where(and(eq(aiUsage.model, KAGGLE_GPU_USAGE_MODEL), gte(aiUsage.day, kaggleWeekStartDay(reset))));
  const minutes = rows.reduce((n, r) => n + r.calls, 0);
  return {
    ...row,
    source: "estimate",
    windows: [makeWindow("Tuần này", Math.round((minutes / 60) * 10) / 10, KAGGLE_WEEKLY_HOURS, "giờ", reset)],
    note: "Cộng phút GPU app đã ghi (từ lúc đẩy kernel đến lúc xong, gồm cả chờ hàng đợi). Chưa đọc được số thật từ Kaggle (thiếu KAGGLE_API_TOKEN trên Vercel).",
  };
}

const failed = (id: string, name: string, brand: LimitRow["brand"], reason: unknown): LimitRow => ({
  id,
  name,
  brand,
  source: "none",
  windows: [],
  note: `Không đọc được: ${reason instanceof Error ? reason.message : String(reason)}`,
  asOf: null,
});

/** Hạn mức mọi nguồn, gọi song song, nhớ 5 phút; một nguồn lỗi chỉ thành hàng "không đọc được". */
export async function loadLimits(): Promise<LimitRow[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  await loadSecrets();
  const todayP = todayUsage();
  todayP.catch(() => {}); // lỗi được báo ở từng hàng cần nó; tránh cảnh báo promise bị bỏ rơi
  const jobs: { id: string; name: string; brand: LimitRow["brand"]; run: () => Promise<LimitRow> }[] = [
    { id: "claude-plan", name: "Claude · gói Pro", brand: "claude", run: claudeRow },
    { id: "chatgpt-plan", name: "ChatGPT · gói Plus (Codex)", brand: "openai", run: chatgptRow },
    { id: "chatgpt-image", name: "Vẽ ảnh · gói ChatGPT Plus", brand: "openai", run: async () => chatgptImageRow(await todayP) },
    { id: "gemini-free", name: "Gemini API miễn phí", brand: "gemini", run: async () => geminiRow("gemini-free", "Gemini API miễn phí", await todayP) },
    { id: "voice", name: "Giọng đọc Gemini", brand: "gemini", run: async () => geminiRow("voice", "Giọng đọc Gemini", await todayP) },
    { id: "cloudflare", name: "Cloudflare Workers AI", brand: "cloudflare", run: async () => cloudflareRow(await todayP) },
    { id: "vidiq", name: "vidIQ", brand: "vidiq", run: vidiqRow },
    { id: "youtube", name: "YouTube Data API", brand: "youtube", run: async () => youtubeRow(await todayP) },
    { id: "github", name: "GitHub Actions", brand: "github", run: githubRow },
    { id: "kaggle", name: "Kaggle GPU (clip động)", brand: "kaggle", run: kaggleRow },
  ];
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const rows = settled.map((r, i) => (r.status === "fulfilled" ? r.value : failed(jobs[i].id, jobs[i].name, jobs[i].brand, r.reason)));
  cache = { at: Date.now(), rows };
  return rows;
}
