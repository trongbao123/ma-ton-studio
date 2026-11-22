// Claude đạo diễn: biến kịch bản lịch sử thành danh sách cảnh (loại cảnh, máy quay, âm thanh, chữ), rồi đổi sang mốc
// thời gian theo giọng đọc. Mỗi loại cảnh có một renderer riêng (scene-map / scene-card / scene-art / scene-terrain).
import { z } from "zod";
import { sentences, type Cue } from "@/../pipeline/text";
import type { TextProvider } from "@/lib/ai/types";
import type { PromptPair } from "./prompts";

/** map = bản đồ phẳng + lính chibi · terrain = địa hình 3D · card = thẻ chữ · art = tranh tư liệu/minh hoạ. */
export type SceneKind = "map" | "terrain" | "card" | "art";
export type SceneSfx = "drum" | "shout" | "horn" | "fire" | "water";

/** Một cảnh do AI đạo diễn; `from`/`to` là chỉ số câu trong kịch bản (tính theo cue của giọng đọc). */
export type DirectedScene = {
  kind: SceneKind;
  from: number;
  to: number;
  title?: string;
  subtitle?: string;
  places?: string[];
  route?: string[];
  battles?: string[];
  artQuery?: string;
  artPrompt?: string;
  camera: "hold" | "push" | "pan";
  sfx: SceneSfx[];
};

/** Cảnh đã gắn mốc giây trên dòng thời gian video. */
export type Shot = DirectedScene & { start: number; end: number };

/** Cảnh dài hơn ngần này bị chia đôi (người xem mỏi mắt); ngắn hơn SCENE_MIN_SECONDS thì gộp (cắt giật). */
export const SCENE_MAX_SECONDS = 6;
export const SCENE_MIN_SECONDS = 3;

export const storyboardSchema = z.object({
  scenes: z.array(
    z.object({
      kind: z.enum(["map", "terrain", "card", "art"]),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      title: z.string().optional(),
      subtitle: z.string().optional(),
      places: z.array(z.string()).optional(),
      route: z.array(z.string()).optional(),
      battles: z.array(z.string()).optional(),
      artQuery: z.string().optional(),
      artPrompt: z.string().optional(),
      camera: z.enum(["hold", "push", "pan"]),
      sfx: z.array(z.enum(["drum", "shout", "horn", "fire", "water"])),
    }),
  ),
});

/** Đánh số sẵn từng câu cho AI — bắt model tự đếm 500+ câu là lệch chắc chắn. */
export function numberSentences(script: string): string {
  return sentences(script)
    .map((sentence, i) => `[${i}] ${sentence}`)
    .join("\n");
}

/** Prompt đạo diễn: kịch bản + hồ sơ → danh sách cảnh phủ kín kịch bản. */
export function storyboardPrompt(script: string, dossierText: string): PromptPair {
  return {
    system: `Bạn là đạo diễn dựng phim tài liệu lịch sử. Bạn KHÔNG viết lại lời kể — bạn quyết mỗi câu lên hình bằng cảnh gì.
Phong cách kênh: bản đồ phẳng màu TRẦM + lính giấy 2D cho hành quân/giao chiến; giấy cũ sepia + tranh khắc cho bối cảnh, mở và kết.
TUYỆT ĐỐI: không châm biếm nhân vật lịch sử, không ảnh chụp hiện vật bảo tàng / tượng đài / ảnh hiện đại, không avatar người dẫn.`,
    prompt: `KỊCH BẢN (mỗi câu có sẵn số thứ tự trong ngoặc vuông — dùng đúng số đó cho "from"/"to"):
<kich_ban>
${numberSentences(script)}
</kich_ban>

HỒ SƠ TƯ LIỆU (chỉ để biết địa danh, nhân vật, mốc thời gian có thật):
<ho_so>
${dossierText}
</ho_so>

Chia kịch bản thành các cảnh. Mỗi cảnh gồm 1–3 câu liền nhau; các cảnh phải PHỦ KÍN kịch bản, không chồng lấn, không bỏ câu nào.
Bốn loại cảnh:
- "map": bản đồ phẳng + lính giấy — dùng cho hành quân, vây hãm, đổi chủ lãnh thổ. Ghi "places" (địa danh xuất hiện), "route" (thứ tự đường đi nếu có), "battles" (địa danh nổ ra giao chiến).
- "terrain": bản đồ địa hình 3D — chỉ 2–4 cảnh ĐẮT GIÁ nhất cả video (mở màn chiến dịch, trận quyết định). Cũng ghi "places"/"route"/"battles".
- "card": thẻ chữ trên nền giấy cũ — mốc thời gian, con số gây sốc, câu trích sử liệu. Ghi "title" (ngắn, in hoa được) và "subtitle".
- "art": tranh tư liệu hoặc tranh minh hoạ — chân dung, cảnh triều đình, bối cảnh. Ghi "artQuery" (từ khoá tìm tranh cổ, tiếng Anh) và "artPrompt" (tả tranh để vẽ nếu không tìm được, nét tranh khắc cổ, đúng trang phục thời đó).
Địa danh trong "places"/"route"/"battles" ghi TÊN TIẾNG VIỆT KÈM TỈNH/NƯỚC để tra toạ độ ("Tam Điệp, Ninh Bình", "Waterloo, Bỉ").
"camera": "hold" (đứng yên), "push" (đẩy nhẹ), "pan" (lia) — cảnh tĩnh và cảnh thẻ chữ dùng "hold" hoặc "push".
"sfx": chỉ đặt ở cảnh CÓ đánh nhau hoặc hành quân — "drum" (trống trận), "shout" (tiếng hô), "horn" (tù và), "fire", "water". Cảnh bối cảnh để mảng rỗng.`,
  };
}

/** Gọi AI đạo diễn, trả danh sách cảnh theo thứ tự câu. */
export async function directScript(ai: TextProvider, script: string, dossierText: string): Promise<DirectedScene[]> {
  const { scenes } = await ai.generateJson({
    ...storyboardPrompt(script, dossierText),
    schema: storyboardSchema,
    temperature: 0.4,
    task: "scenes",
    maxOutputTokens: 32_000,
  });
  return scenes.sort((a, b) => a.from - b.from);
}

/**
 * Mốc giây của từng CÂU. Mốc giọng (cue) nhỏ hơn câu — text.ts còn chẻ câu dài thành nhiều cue 70 ký tự —
 * nên không được tra `cues[chỉ số câu]`: phải quy theo tỉ lệ ký tự trên toàn bộ lời đọc.
 */
export function sentenceTimes(cues: Cue[], seconds: number): { start: number; end: number }[] {
  const spoken = cues.map((c) => c.text).join(" ");
  const parts = sentences(spoken);
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  let walked = 0;
  return parts.map((part) => {
    const start = (walked / total) * seconds;
    walked += part.length;
    return { start, end: (walked / total) * seconds };
  });
}

/** Chia một shot quá dài thành các phần ≤ SCENE_MAX_SECONDS, cắt đều. */
function splitLong(shot: Shot): Shot[] {
  const length = shot.end - shot.start;
  if (length <= SCENE_MAX_SECONDS) return [shot];
  const parts = Math.ceil(length / SCENE_MAX_SECONDS);
  const each = length / parts;
  return Array.from({ length: parts }, (_, i) => ({ ...shot, start: shot.start + each * i, end: shot.start + each * (i + 1) }));
}

/** Gộp shot ngắn hơn SCENE_MIN_SECONDS vào shot trước (hoặc shot sau nếu nó là shot đầu). */
function mergeShort(shots: Shot[]): Shot[] {
  const merged: Shot[] = [];
  for (const shot of shots) {
    const previous = merged.at(-1);
    if (previous && shot.end - shot.start < SCENE_MIN_SECONDS) previous.end = shot.end;
    else merged.push({ ...shot });
  }
  // Shot đầu quá ngắn: gộp xuống shot sau.
  if (merged.length > 1 && merged[0].end - merged[0].start < SCENE_MIN_SECONDS) {
    merged[1].start = merged[0].start;
    merged.shift();
  }
  return merged;
}

/**
 * Cảnh của AI → shot có mốc giây: quy chỉ số câu ra giây, chia cảnh dài, gộp cảnh ngắn, nối liền mạch.
 * AI phủ thiếu phần cuối thì CHÈN THÊM cảnh (nhân bản cảnh cuối) — không giãn một cảnh ra hàng chục phút.
 */
export function scenesToShots(scenes: DirectedScene[], cues: Cue[], seconds: number): Shot[] {
  const times = sentenceTimes(cues, seconds);
  const spanOf = (from: number, to: number) => {
    const first = times[Math.min(Math.max(0, from), times.length - 1)];
    const last = times[Math.min(Math.max(0, to), times.length - 1)];
    return { start: first?.start ?? 0, end: Math.max(last?.end ?? seconds, (first?.start ?? 0) + 0.1) };
  };
  const raw = scenes.flatMap((scene) => splitLong({ ...scene, ...spanOf(scene.from, scene.to) }));
  const shots = mergeShort(raw);
  if (!shots.length) return [];
  shots[0].start = 0;
  for (let i = 1; i < shots.length; i++) shots[i].start = shots[i - 1].end;
  return chainToEnd(shots, seconds);
}

/** Nối các shot liền mạch tới hết giọng đọc; thiếu thì thêm cảnh mới giống cảnh cuối, thừa thì cắt bớt. */
function chainToEnd(shots: Shot[], seconds: number): Shot[] {
  const filled = shots.filter((shot) => shot.start < seconds);
  const last = filled.at(-1)!;
  if (last.end > seconds) last.end = seconds;
  while (last.end < seconds || filled.at(-1)!.end < seconds) {
    const tail = filled.at(-1)!;
    if (tail.end >= seconds) break;
    const end = Math.min(seconds, tail.end + SCENE_MAX_SECONDS);
    filled.push({ ...tail, start: tail.end, end });
  }
  const tail = filled.at(-1)!;
  // Phần đuôi ngắn hơn cảnh tối thiểu: nhập vào cảnh trước thay vì để một cảnh chớp nhoáng.
  if (filled.length > 1 && tail.end - tail.start < SCENE_MIN_SECONDS) {
    filled[filled.length - 2].end = tail.end;
    filled.pop();
  }
  return filled;
}
