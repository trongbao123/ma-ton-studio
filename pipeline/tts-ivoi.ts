import { rm, writeFile } from "node:fs/promises";
import { ffmpeg } from "./ffmpeg";

/** ivoi.io (TTS tiếng Việt, tính credit theo ký tự). Base URL có "/api/api" — đúng như trang API của họ. */
const BASE = process.env.IVOI_BASE_URL ?? "https://ivoi.io/api/api/v1";
/** Người kể chuyện đời: nữ = Quỳnh Anh 3.0 (user chọn 18/11/2026 sau khi nghe thử), nam = Ngạn Anh ("người già"). */
export const IVOI_VOICE_FEMALE = process.env.IVOI_VOICE_FEMALE ?? "vi_quynhanh_ipa";
export const IVOI_VOICE_MALE = process.env.IVOI_VOICE_MALE ?? "vi_male_ngocngan_ipa";
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

/** Đọc `text` bằng giọng `voiceId`, ghi WAV 24kHz mono (cùng định dạng Gemini để nối/đo khoảng lặng như cũ). */
export async function speakIvoi(text: string, outFile: string, voiceId: string) {
  if (text.length > IVOI_MAX_CHARS) throw new Error(`ivoi: đoạn ${text.length} ký tự > ${IVOI_MAX_CHARS}`);
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
    job = await call(`/tts/jobs/${job.job_id}`);
  }
  const audio = await fetch(job.audio_url!);
  if (!audio.ok) throw new Error(`ivoi tải audio ${audio.status}`);
  const mp3 = `${outFile}.mp3`;
  await writeFile(mp3, Buffer.from(await audio.arrayBuffer()));
  try {
    await ffmpeg(["-y", "-i", mp3, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", outFile]);
  } finally {
    await rm(mp3, { force: true });
  }
}
