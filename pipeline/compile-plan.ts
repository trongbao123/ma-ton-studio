// Phần thuần của bản gộp (không đụng DB/ffmpeg) — dễ test.

/** Số chương tối thiểu để gộp một bản. */
export const COMPILE_SIZE = 5;

export type CompileCandidate = { chapterId: number; number: number; title: string; videoId: number };

/** Lấy `size` chương LIỀN NHAU (số chương kế tiếp) sớm nhất; chương trùng số thì giữ video mới nhất. Không đủ → null. */
export function pickBatch(list: CompileCandidate[], size = COMPILE_SIZE): CompileCandidate[] | null {
  const byNumber = new Map<number, CompileCandidate>();
  for (const c of list) {
    const old = byNumber.get(c.number);
    if (!old || c.videoId > old.videoId) byNumber.set(c.number, c);
  }
  const sorted = [...byNumber.values()].sort((a, b) => a.number - b.number);
  let run: CompileCandidate[] = [];
  for (const c of sorted) {
    run = run.length && c.number === run[run.length - 1].number + 1 ? [...run, c] : [c];
    if (run.length === size) return run;
  }
  return null;
}

/** 75 → "01:15"; 3725 → "1:02:05" (YouTube chapters: ≥ 1 giờ dùng H:MM:SS). */
export function formatTimestamp(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Mục lục chương kiểu YouTube: dòng đầu "00:00 Chương N: …", các mốc sau cộng dồn thời lượng chương trước. */
export function buildChapterMarks(items: { number: number; title: string; seconds: number }[]) {
  let at = 0;
  return items
    .map((it) => {
      const line = `${formatTimestamp(at)} Chương ${it.number}: ${it.title}`;
      at += it.seconds;
      return line;
    })
    .join("\n");
}

/** Gom các khối ghi công nhạc nền (bắt đầu "\n\nNhạc nền:") từ mô tả các chương, bỏ trùng, giữ thứ tự. */
export function collectMusicCredits(descriptions: string[]) {
  const seen = new Set<string>();
  for (const d of descriptions) {
    const block = d.match(/\n\nNhạc nền:[\s\S]*$/)?.[0]?.trim();
    if (block) seen.add(block);
  }
  return [...seen];
}

/** Khung 12:00 giờ VN (05:00 UTC) gần nhất ≥ 2 giờ nữa và chưa ai giữ (`taken` = các mốc publishAt hiện có). */
export function nextCompileSlot(taken: Date[], now = new Date()) {
  const used = new Set(taken.map((t) => t.getTime()));
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5));
  while (slot.getTime() - now.getTime() < 2 * 3600_000 || used.has(slot.getTime())) slot.setUTCDate(slot.getUTCDate() + 1);
  return slot;
}

export const compileLabel = (from: number, to: number) => `${from}–${to}`;
