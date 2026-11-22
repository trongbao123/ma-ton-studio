// BẢN THỬ GIỌNG (spike, bỏ sau khi chủ kênh chốt): đọc cùng một đoạn mở đầu bằng MỌI giọng nam ivoi + các giọng Gemini
// hợp phim tài liệu, rồi đưa lên release "history-preview" để chủ kênh nghe chọn.
// CLI: render.ts "voices"
import { execFile } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadSecrets } from "@/lib/secrets";
import { speak } from "./tts";
import { ivoiReady } from "./tts-ivoi";

const run = promisify(execFile);
const DIR = path.resolve(".render", "voice-audition");
/** Đoạn mở đầu kịch bản Quang Trung — đủ dài để nghe rõ nhịp kể, đủ ngắn để không tốn nhiều credit. */
const SAMPLE =
  "Đêm 30 Tết năm Mậu Thân. Dãy núi Tam Điệp chìm trong bóng tối cuối năm. " +
  "Dưới chân núi, một đạo quân vừa ăn Tết, sớm hơn mọi mái nhà trên đất Bắc. " +
  "Rồi lệnh truyền khắp doanh trại: tiến quân. Người cầm quân hẹn với ba quân rằng mồng 7 tháng Giêng, tất cả sẽ vào ăn Tết ở Thăng Long.";

/**
 * Giọng Gemini hợp người dẫn phim tài liệu (Google mô tả trong ngoặc). Charon/Algenib đã nghe ở vòng trước.
 */
const GEMINI_VOICES = ["Orus", "Alnilam", "Rasalgethi", "Iapetus", "Sadaltager", "Schedar", "Algieba", "Umbriel", "Enceladus", "Zubenelgenubi"];

const IVOI_BASE = process.env.IVOI_BASE_URL ?? "https://ivoi.io/api/api/v1";
const JOB_TIMEOUT_MS = 180_000;
const POLL_MS = 3_000;

type IvoiJob = { job_id?: string; status?: string; audio_url?: string | null; error_message?: string | null };

/**
 * Đọc thử MỘT giọng, gọi thẳng API: speakIvoi dùng lại bản đọc cũ cùng nội dung, nên thử nhiều giọng với cùng một đoạn
 * sẽ trả về đúng một giọng cho tất cả (đã dính lỗi này ở vòng trước).
 */
async function synthOnce(text: string, voiceId: string, outFile: string) {
  const api = async (pathname: string, init?: RequestInit) => {
    const sent = await fetch(`${IVOI_BASE}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${process.env.IVOI_API_KEY}`, "Content-Type": "application/json", ...init?.headers },
    });
    const body = (await sent.json().catch(() => ({}))) as IvoiJob;
    if (!sent.ok) throw new Error(`ivoi ${sent.status}: ${JSON.stringify(body).slice(0, 160)}`);
    return body;
  };
  let job = await api("/tts/synthesize", { method: "POST", body: JSON.stringify({ text, voice_id: voiceId, format: "mp3", speed: 1.0 }) });
  const until = Date.now() + JOB_TIMEOUT_MS;
  while (job.status !== "completed") {
    if (job.status === "failed" || job.status === "error") throw new Error(`job lỗi: ${job.error_message ?? "không rõ"}`);
    if (Date.now() > until) throw new Error(`job ${job.job_id} quá ${JOB_TIMEOUT_MS / 1000} giây`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    job = await api(`/tts/jobs/${job.job_id}`);
  }
  const audio = await fetch(job.audio_url!);
  if (!audio.ok) throw new Error(`tải audio ${audio.status}`);
  await writeFile(outFile, Buffer.from(await audio.arrayBuffer()));
}

type IvoiVoice = { voice_id?: string; id?: string; name?: string; gender?: string; description?: string; price_multiplier?: number };

/** Danh sách giọng ivoi (API đổi tên trường giữa các bản — nhận cả voice_id lẫn id). */
async function ivoiVoices(): Promise<IvoiVoice[]> {
  const base = process.env.IVOI_BASE_URL ?? "https://ivoi.io/api/api/v1";
  // API đổi đường dẫn giữa các bản — thử lần lượt, lấy danh sách đầu tiên có dữ liệu.
  for (const pathname of ["/tts/voices", "/voices", "/tts/voice"]) {
    const found = await fetch(`${base}${pathname}`, { headers: { Authorization: `Bearer ${process.env.IVOI_API_KEY}` } })
      .then(async (r) => (r.ok ? ((await r.json()) as IvoiVoice[] | { data?: IvoiVoice[]; voices?: IvoiVoice[] }) : null))
      .catch(() => null);
    const fromApi = Array.isArray(found) ? found : (found?.data ?? found?.voices ?? []);
    if (fromApi.length) {
      console.log(`ivoi: lấy giọng từ ${pathname}`);
      return fromApi;
    }
  }
  throw new Error("Không endpoint nào trả danh sách giọng");
}

const isMale = (v: IvoiVoice) => /male|nam/i.test(`${v.gender ?? ""}`) && !/female|nữ/i.test(`${v.gender ?? ""}`);
/** Giọng nhân bản tính giá ×2,5 — bỏ qua để không đốt credit. */
const isStandardPrice = (v: IvoiVoice) => (v.price_multiplier ?? 1) <= 1;

/** Đọc thử SAMPLE bằng mọi giọng nam ivoi giá thường + các giọng Gemini; lỗi giọng nào chỉ log giọng đó. */
export async function auditionVoices() {
  await loadSecrets(true);
  await mkdir(DIR, { recursive: true });
  const made: string[] = [];

  if (ivoiReady()) {
    const voices = await ivoiVoices().catch((e: unknown) => {
      console.warn("⚠ Không lấy được danh sách giọng ivoi:", e instanceof Error ? e.message : e);
      return [] as IvoiVoice[];
    });
    const males = voices.filter((v) => isMale(v) && isStandardPrice(v));
    console.log(`ivoi: ${voices.length} giọng, ${males.length} giọng nam giá thường`);
    for (const v of males) {
      const id = v.voice_id ?? v.id;
      if (!id) continue;
      const file = path.join(DIR, `ivoi-${id}.mp3`);
      await synthOnce(SAMPLE, id, file).then(
        () => {
          made.push(file);
          console.log(`  ✔ ${id}${v.name ? ` — ${v.name}` : ""}${v.description ? ` (${v.description.slice(0, 60)})` : ""}`);
        },
        (e: unknown) => console.warn(`  ✗ ${id}: ${e instanceof Error ? e.message : e}`),
      );
    }
  }

  for (const v of GEMINI_VOICES) {
    const file = path.join(DIR, `gemini-${v}.wav`);
    await speak(SAMPLE, file, v).then(
      () => {
        made.push(file);
        console.log(`  ✔ Gemini ${v}`);
      },
      (e: unknown) => console.warn(`  ✗ Gemini ${v}: ${e instanceof Error ? e.message : e}`),
    );
  }

  console.log(`Đã tạo ${made.length} mẫu giọng`);
  if (!process.env.GITHUB_ACTIONS || !made.length) return;
  const tag = "history-preview";
  await run("gh", ["release", "view", tag]).catch(() => run("gh", ["release", "create", tag, "--title", "Kênh lịch sử — đoạn mẫu", "--notes", "Bản dựng thử."]));
  // Upload theo lô: một lệnh quá nhiều file dễ vượt giới hạn dòng lệnh.
  const files = (await readdir(DIR)).filter((f) => /\.(mp3|wav)$/.test(f)).map((f) => path.join(DIR, f));
  for (let i = 0; i < files.length; i += 10) await run("gh", ["release", "upload", tag, ...files.slice(i, i + 10), "--clobber"]);
  console.log(`✔ Mẫu giọng: https://github.com/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}`);
}
