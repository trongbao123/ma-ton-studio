// Kiểm chất lượng tập TRƯỚC KHI upload — so với kênh top cùng ngách (Não Phẳng Tu Tiên, 505–650k view: 13–15 cắt/phút,
// không khung đứng im, cắt thẳng). Lý do có: tập 25/29 lên sóng với 1 ảnh đứng im 58–67 giây ở đầu → còn ~17% người xem sau 45s.
// Không đạt thì KHÔNG upload; nếu lỗi nằm ở chương mở tập dựng kiểu cũ thì xếp hàng render lại chương đó.
import { duration, ffmpegLog } from "./ffmpeg";

/** Ngưỡng đo trên 10 phút đầu. Đo thật: bản kiểu mới 14,4 cắt/phút, đứng im dài nhất 0s; tập 25/29: 0 cắt, 57–66s đứng im. */
export const QC = { seconds: 600, minCutsPerMin: 10, maxFreezeSeconds: 8, maxBlackSeconds: 0.6, lufs: [-20, -11] as const };

export type QcMetrics = { seconds: number; cuts: number; longestFreeze: number; freezeAt: number | null; longestBlack: number; blackAt: number | null; lufs: number | null };
export type QcResult = { ok: boolean; metrics: QcMetrics; problems: string[] };

/** Chấm theo ngưỡng — thuần, để test. */
export function judgeQc(m: QcMetrics, t = QC): QcResult {
  const problems: string[] = [];
  const perMin = m.seconds > 0 ? (m.cuts / m.seconds) * 60 : 0;
  if (perMin < t.minCutsPerMin) problems.push(`nhịp cắt ${perMin.toFixed(1)}/phút < ${t.minCutsPerMin} (kênh top 13–15)`);
  if (m.longestFreeze > t.maxFreezeSeconds) problems.push(`hình đứng im ${m.longestFreeze.toFixed(1)}s ở giây ${Math.round(m.freezeAt ?? 0)} (tối đa ${t.maxFreezeSeconds}s)`);
  if (m.longestBlack > t.maxBlackSeconds) problems.push(`màn đen ${m.longestBlack.toFixed(1)}s ở giây ${Math.round(m.blackAt ?? 0)}`);
  if (m.lufs != null && (m.lufs < t.lufs[0] || m.lufs > t.lufs[1])) problems.push(`âm lượng ${m.lufs.toFixed(1)} LUFS ngoài [${t.lufs[0]}, ${t.lufs[1]}]`);
  return { ok: problems.length === 0, metrics: m, problems };
}

/** Đọc log ffmpeg (showinfo + freezedetect + blackdetect + ebur128) thành số đo — thuần, để test. Màn đen 1 giây đầu bỏ qua. */
export function parseQcLog(videoLog: string, audioLog: string, seconds: number): QcMetrics {
  const cuts = (videoLog.match(/pts_time:/g) ?? []).length;
  // Đọc tuần tự: freeze_start mở một đoạn, freeze_duration đóng đoạn đang mở (có start không kèm duration — đừng ghép theo chỉ số).
  // Đoạn còn mở tới hết cửa sổ đo → tính tới cuối cửa sổ.
  const freezes: { at: number; d: number }[] = [];
  let open: number | null = null;
  for (const x of videoLog.matchAll(/freeze_(start|duration): ([\d.]+)/g)) {
    if (x[1] === "start") {
      if (open != null) freezes.push({ at: open, d: 0 });
      open = Number(x[2]);
    } else if (open != null) {
      freezes.push({ at: open, d: Number(x[2]) });
      open = null;
    }
  }
  if (open != null) freezes.push({ at: open, d: Math.max(0, seconds - open) });
  const blacks = [...videoLog.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)]
    .map((x) => ({ at: Number(x[1]), d: Number(x[3]) }))
    .filter((b) => b.at > 1);
  const fz = [...freezes].sort((a, b) => b.d - a.d)[0];
  const bk = [...blacks].sort((a, b) => b.d - a.d)[0];
  const lufs = audioLog.match(/I:\s+(-?[\d.]+) LUFS/);
  return { seconds, cuts, longestFreeze: fz?.d ?? 0, freezeAt: fz?.at ?? null, longestBlack: bk?.d ?? 0, blackAt: bk?.at ?? null, lufs: lufs ? Number(lufs[1]) : null };
}

/** Đo `seconds` giây đầu của file (2 lượt ffmpeg: hình thu nhỏ 320px, rồi âm thanh). */
export async function measureQc(file: string, limit = QC.seconds): Promise<QcMetrics> {
  // Cửa sổ đo = 10 phút đầu, hoặc cả file nếu ngắn hơn (không thì nhịp cắt bị chia cho 600 giây). -t ĐẶT SAU -i (đặt trước không giới hạn).
  const seconds = Math.min(limit, await duration(file));
  const videoLog = await ffmpegLog([
    "-i", file, "-t", String(seconds), "-an",
    "-vf", "scale=320:-2,freezedetect=n=0.003:d=6,blackdetect=d=0.3:pix_th=0.1,select='gt(scene,0.3)',showinfo",
    "-f", "null", "-",
  ]);
  const audioLog = await ffmpegLog(["-i", file, "-t", String(seconds), "-vn", "-af", "ebur128=framelog=quiet", "-f", "null", "-"]);
  return parseQcLog(videoLog, audioLog, seconds);
}

export class QcFailedError extends Error {}
