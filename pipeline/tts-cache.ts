// File giọng đọc cache theo SỐ THỨ TỰ đoạn (tts-<giọng>-<i>.wav) — văn bản đổi (vd bỏ câu đọc tên chương) thì ranh giới đoạn xê dịch
// mà file cũ vẫn được dùng → audio cũ, phụ đề/cảnh tính theo chữ mới, lệch cả video. Ghi kèm văn bản đã đọc để phát hiện.
import { readFile, rm, writeFile } from "node:fs/promises";

const mark = (wav: string) => `${wav}.txt`;

/** Ghi văn bản vừa đọc cạnh file giọng. */
export async function markTts(wav: string, text: string) {
  await writeFile(mark(wav), text);
}

/**
 * Văn bản đã đọc khác `text` → xoá file giọng + các bản dẫn xuất (`derived`, vd bản tăng tốc) để đọc lại.
 * Chưa có dấu văn bản (cache từ trước bản sửa này) thì giữ nguyên: không biết chắc thì không đốt lượt giọng (10 lượt/ngày).
 */
export async function dropStaleTts(wav: string, derived: string[], text: string) {
  const said = await readFile(mark(wav), "utf8").catch(() => null);
  if (said === null || said === text) return;
  await Promise.all([wav, ...derived, mark(wav)].map((f) => rm(f, { force: true })));
}
