// Claude đạo diễn: biến kịch bản lịch sử thành danh sách cảnh (loại cảnh, máy quay, âm thanh, chữ), rồi đổi sang mốc
// thời gian theo giọng đọc. Mỗi loại cảnh có một renderer riêng (scene-map / scene-card / scene-art / scene-terrain).
import { z } from "zod";
import type { Cue } from "@/../pipeline/text";
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

/** Prompt đạo diễn: kịch bản + hồ sơ → danh sách cảnh phủ kín kịch bản. */
export function storyboardPrompt(script: string, dossierText: string): PromptPair {
  return {
    system: `Bạn là đạo diễn dựng phim tài liệu lịch sử. Bạn KHÔNG viết lại lời kể — bạn quyết mỗi câu lên hình bằng cảnh gì.
Phong cách kênh: bản đồ phẳng màu TRẦM + lính giấy 2D cho hành quân/giao chiến; giấy cũ sepia + tranh khắc cho bối cảnh, mở và kết.
TUYỆT ĐỐI: không châm biếm nhân vật lịch sử, không ảnh chụp hiện vật bảo tàng / tượng đài / ảnh hiện đại, không avatar người dẫn.`,
    prompt: `KỊCH BẢN (đánh số câu từ 0):
<kich_ban>
${script}
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

/** Giây bắt đầu/kết thúc của một dải câu theo cue giọng đọc. */
function spanOf(cues: Cue[], from: number, to: number, seconds: number) {
  const first = cues[Math.min(from, cues.length - 1)];
  const last = cues[Math.min(to, cues.length - 1)];
  return { start: first?.start ?? 0, end: last?.end ?? seconds };
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

/** Cảnh của AI → shot có mốc giây: chia cảnh dài, gộp cảnh ngắn, cảnh cuối khớp đúng độ dài giọng đọc. */
export function scenesToShots(scenes: DirectedScene[], cues: Cue[], seconds: number): Shot[] {
  const raw = scenes.flatMap((scene) => splitLong({ ...scene, ...spanOf(cues, scene.from, scene.to, seconds) }));
  const shots = mergeShort(raw);
  if (!shots.length) return [];
  shots[0].start = 0;
  shots[shots.length - 1].end = seconds;
  for (let i = 1; i < shots.length; i++) shots[i].start = shots[i - 1].end;
  return shots;
}
