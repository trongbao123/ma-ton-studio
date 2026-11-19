import { access, rename, rm, writeFile } from "node:fs/promises";
import { ffmpeg } from "./ffmpeg";

/** ivoi.io (TTS tiếng Việt, tính credit theo ký tự). Base URL có "/api/api" — đúng như trang API của họ. */
const BASE = process.env.IVOI_BASE_URL ?? "https://ivoi.io/api/api/v1";
/** Người kể chuyện đời: nữ = Quỳnh Anh 3.0 (user chọn 18/11/2026 sau khi nghe thử), nam = Ngạn Anh ("người già"). */
export const IVOI_VOICE_FEMALE = process.env.IVOI_VOICE_FEMALE ?? "vi_quynhanh_ipa";
export const IVOI_VOICE_MALE = process.env.IVOI_VOICE_MALE ?? "vi_male_ngocngan_ipa";
/**
 * Giọng ivoi THƯỜNG (hệ số giá ×1,0 — không dùng giọng nhân bản ×2,5) theo giới/tuổi cho phân vai chuyện đời.
 * Nữ chỉ có 2 giọng thường: người kể Quỳnh Anh 3.0, nhân vật nữ dùng chung Quỳnh Anh 5.0.
 */
export const IVOI_VOICES = {
  female: {
    old: [IVOI_VOICE_FEMALE, "vi_female_quynh_anh"],
    mid: ["vi_female_quynh_anh", IVOI_VOICE_FEMALE],
    young: ["vi_female_quynh_anh", IVOI_VOICE_FEMALE],
  },
  male: {
    old: [IVOI_VOICE_MALE, "vi_taman_phat", "vi_male_duyonyx_1"],
    mid: ["vi_hoangnam_story_ipa", "vi_male_duyonyx_1", "vi_male_baotrung_1"],
    young: ["vi_male_anhquan_1", "vi_male_adam", "vi_hoangnam_story"],
  },
} as const;

/** Giới hạn ký tự mỗi lượt của ivoi là 5.000 — chia đoạn ≤ 4.000 như Gemini là đủ. */
export const IVOI_MAX_CHARS = 5000;
/** Tiền tố tên giọng trong pipeline (`narrate`): "ivoi-<voice_id>" → đọc bằng ivoi, tên file cache tách khỏi giọng Gemini. */
export const IVOI_PREFIX = "ivoi-";

/** Hết credit / key sai — người gọi quay về Gemini thay vì treo video. */
export class IvoiUnavailableError extends Error {}

export const ivoiReady = () => Boolean(process.env.IVOI_API_KEY);

async function call(pathname: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.IVOI_API_KEY}`, "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = `ivoi ${res.status}: ${JSON.stringify(body?.detail ?? body).slice(0, 200)}`;
    // 401/402/403 hoặc báo thiếu credit/token → không thử lại được.
    if ([401, 402, 403].includes(res.status) || /credit|token|insufficient|không đủ|số dư/i.test(msg)) throw new IvoiUnavailableError(msg);
    throw new Error(msg);
  }
  return body;
}

/** Số đoạn lấy lại từ job cũ trong lần chạy này (log để đối chiếu tiền). */
let reused = 0;
export const ivoiReusedCount = () => reused;

/** Tiêu đề ivoi tự đặt cho job: ≤ 50 ký tự thì nguyên văn, dài hơn thì 50 ký tự đầu + "..." (đo 433 job ngày 19/11/2026). */
export const ivoiTitle = (text: string) => (text.length > 50 ? `${text.slice(0, 50)}...` : text);

type OldJob = { url: string; seconds: number };
let jobIndex: Promise<Map<string, OldJob[]>> | null = null;

/** Mọi job đã xong trên tài khoản (ivoi giữ audio 30 ngày), gom theo tiêu đề. Tải 1 lần mỗi tiến trình. */
function loadJobIndex() {
  jobIndex ??= (async () => {
    const map = new Map<string, OldJob[]>();
    for (let offset = 0, total = Infinity; offset < total; offset += 100) {
      const page = (await retry(() => call(`/tts/jobs?limit=100&offset=${offset}`))) as {
        total: number;
        jobs: { status: string; title: string; audio_url: string | null; duration_seconds: number | null }[];
      };
      total = page.total;
      if (!page.jobs.length) break;
      for (const j of page.jobs) {
        if (j.status !== "completed" || !j.audio_url) continue;
        map.set(j.title, [...(map.get(j.title) ?? []), { url: j.audio_url, seconds: j.duration_seconds ?? 0 }]);
      }
    }
    console.log(`  ivoi: ${map.size} đoạn đã đọc trên tài khoản (dùng lại nếu file mất)`);
    return map;
  })().catch((e) => {
    console.warn("⚠ Không tải được danh sách job ivoi — đọc mới:", e instanceof Error ? e.message : e);
    return new Map<string, OldJob[]>();
  });
  return jobIndex;
}

/**
 * Job cũ cùng nội dung: khớp tiêu đề; đoạn > 50 ký tự còn phải khớp độ dài audio (ivoi đọc ~18,7 ký tự/giây — đo #66)
 * để không lấy nhầm đoạn khác trùng 50 ký tự đầu. Không chắc thì trả null (đọc mới, đúng hơn là tiết kiệm sai).
 */
export function pickOldJob(text: string, candidates: OldJob[] | undefined): string | null {
  if (!candidates?.length) return null;
  if (text.length <= 50) return candidates[0].url;
  const expect = text.length / 18.7;
  const ok = candidates.filter((c) => c.seconds >= expect * 0.75 - 1 && c.seconds <= expect * 1.35 + 1);
  return ok[0]?.url ?? null;
}

async function findOldJob(text: string) {
  return pickOldJob(text, (await loadJobIndex()).get(ivoiTitle(text)));
}

/** Thử lại lỗi mạng/tạm thời (không thử lại hết credit / key sai). */
async function retry<T>(fn: () => Promise<T>, times = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof IvoiUnavailableError || i >= times - 1) throw e;
      await new Promise((r) => setTimeout(r, 5_000 * (i + 1)));
    }
  }
}

/** Đọc `text` bằng giọng `voiceId`, ghi WAV 24kHz mono (cùng định dạng Gemini để nối/đo khoảng lặng như cũ). */
export async function speakIvoi(text: string, outFile: string, voiceId: string) {
  // Đã đọc ở lần chạy trước (cache .render trên Actions) → KHÔNG gọi lại: ivoi tính tiền mỗi lần gọi.
  // Tên file do người gọi đặt theo nội dung (narrateScript: hash nhóm; narrate: dropStaleTts xoá khi chữ đổi).
  if (await access(outFile).then(() => true, () => false)) return;
  if (text.length > IVOI_MAX_CHARS) throw new Error(`ivoi: đoạn ${text.length} ký tự > ${IVOI_MAX_CHARS}`);
  // Đoạn này đã từng đọc (trả tiền) ở job trước nhưng file mất (cache Actions bị đẩy ra / job bị huỷ) → tải lại audio cũ.
  const old = await findOldJob(text);
  if (old) {
    await saveAudio(old, outFile);
    reused++;
    return;
  }
  let job: { job_id?: string; status?: string; audio_url?: string | null; error_message?: string | null } = {};
  for (let attempt = 0; ; attempt++) {
    try {
      job = await call("/tts/synthesize", { method: "POST", body: JSON.stringify({ text, voice_id: voiceId, format: "mp3", speed: 1.0 }) });
      break;
    } catch (e) {
      if (e instanceof IvoiUnavailableError || attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 10_000 * (attempt + 1)));
    }
  }
  // Job xử lý vài giây tới ~30 giây; ivoi tự huỷ sau 2 phút (hoàn credit) → chờ tối đa 3 phút.
  const until = Date.now() + 180_000;
  while (job.status !== "completed") {
    if (job.status === "failed" || job.status === "error") throw new Error(`ivoi job lỗi: ${job.error_message ?? "không rõ"}`);
    if (Date.now() > until) throw new Error(`ivoi job ${job.job_id} quá 3 phút`);
    await new Promise((r) => setTimeout(r, 3000));
    job = await retry(() => call(`/tts/jobs/${job.job_id}`));
  }
  await saveAudio(job.audio_url!, outFile);
}

/** Tải mp3 của job → WAV 24kHz mono. Audio đã trả tiền → tải lại tới khi được (s3.ivoi.io từng timeout 10s). */
async function saveAudio(url: string, outFile: string) {
  const data = await retry(async () => {
    const audio = await fetch(url);
    if (!audio.ok) throw new Error(`ivoi tải audio ${audio.status}`);
    return Buffer.from(await audio.arrayBuffer());
  }, 6);
  const mp3 = `${outFile}.mp3`;
  await writeFile(mp3, data);
  try {
    // Ghi ra file tạm rồi đổi tên: file hỏng giữa chừng không bị lần sau coi là đã đọc.
    const tmp = `${outFile}.tmp.wav`;
    await ffmpeg(["-y", "-i", mp3, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", tmp]);
    await rename(tmp, outFile);
  } finally {
    await rm(mp3, { force: true });
  }
}

/** Số tiêu đề đã đọc trên tài khoản (kiểm tra / log). */
export const ivoiJobIndexSize = async () => (await loadJobIndex()).size;
