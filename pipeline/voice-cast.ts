// "Đạo diễn giọng đọc" cho truyện chuyện đời (chủ kênh 17/11/2026: một giọng đọc đều đều, nhanh → "đéo truyền cảm"):
// AI chia truyện thành lượt lời (người kể "tôi" / từng nhân vật), gắn cảm xúc + thẻ hơi thở (<sigh>, <sob>, <long pause>),
// rồi phân vai: mỗi nhân vật một giọng Gemini theo giới tính + tuổi. Gemini TTS nhận tối đa 2 giọng / lượt gọi →
// gom các lượt liền nhau thành nhóm ≤ 2 giọng. CHỮ của truyện giữ nguyên (kiểm lại), chỉ thêm thẻ.
import { z } from "zod";
import { textProvider } from "@/lib/ai";

export const NARRATOR = "narrator";

/** Giọng Gemini theo giới tính / lứa tuổi (mô tả của Google: Gacrux Mature, Sulafat Warm, Vindemiatrix Gentle…). */
const VOICES = {
  female: { old: ["Gacrux", "Sulafat"], mid: ["Sulafat", "Vindemiatrix", "Achernar"], young: ["Leda", "Aoede", "Despina"] },
  male: { old: ["Algenib", "Schedar"], mid: ["Charon", "Iapetus", "Orus"], young: ["Achird", "Puck", "Umbriel"] },
} as const;

export type Gender = "male" | "female";
export type Person = { name: string; gender: Gender; age: number };
export type Turn = { speaker: string; style: string; text: string };
export type Script = { narrator: { gender: Gender; age: number }; characters: Person[]; turns: Turn[] };

const band = (age: number) => (age >= 50 ? "old" : age >= 28 ? "mid" : "young");

/**
 * Phân vai: người kể trước, rồi nhân vật nhiều lời thoại trước; mỗi người lấy giọng đầu tiên còn trống trong nhóm tuổi/giới
 * của mình (hết thì lấy nhóm khác cùng giới, rồi mới dùng lại). Trả map speaker → voice.
 */
export function castVoices(s: Pick<Script, "narrator" | "characters" | "turns">): Record<string, string> {
  const used = new Set<string>();
  const pick = (g: Gender, age: number) => {
    const order = [...VOICES[g][band(age)], ...Object.values(VOICES[g]).flat()];
    const v = order.find((x) => !used.has(x)) ?? VOICES[g][band(age)][0];
    used.add(v);
    return v;
  };
  const cast: Record<string, string> = { [NARRATOR]: pick(s.narrator.gender, s.narrator.age) };
  const lines = (n: string) => s.turns.filter((t) => t.speaker === n).length;
  for (const c of [...s.characters].sort((a, b) => lines(b.name) - lines(a.name))) cast[c.name] = pick(c.gender, c.age);
  return cast;
}

export const stripTags = (t: string) => t.replace(/<[^>]{1,30}>/g, " ").replace(/\s+/g, " ").trim();
/** So khớp chữ: bỏ thẻ, dấu câu, khoảng trắng, hoa/thường. */
const letters = (t: string) => stripTags(t).normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Kịch bản giữ đúng chữ truyện không (cho phép lệch ≤ 1% ký tự — AI hay đổi một dấu gạch thoại, ngoặc). */
export function faithful(original: string, turns: Turn[]) {
  const a = letters(original);
  const b = letters(turns.map((t) => t.text).join(" "));
  if (!a.length) return false;
  if (a === b) return true;
  // Lệch độ dài lớn = AI bỏ/thêm đoạn → không nhận.
  if (Math.abs(a.length - b.length) / a.length > 0.01) return false;
  let same = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) same++;
  return same / a.length > 0.97;
}

/** Gom lượt liền nhau thành nhóm gọi TTS: ≤ 2 giọng khác nhau, ≤ maxChars ký tự. */
export function groupTurns(turns: Turn[], cast: Record<string, string>, maxChars = 3000): Turn[][] {
  const groups: Turn[][] = [];
  let cur: Turn[] = [];
  let voices = new Set<string>();
  let size = 0;
  for (const t of turns) {
    const v = cast[t.speaker] ?? cast[NARRATOR];
    const next = new Set(voices).add(v);
    if (cur.length && (next.size > 2 || size + t.text.length > maxChars)) {
      groups.push(cur);
      cur = [];
      voices = new Set();
      size = 0;
    }
    cur.push(t);
    voices.add(v);
    size += t.text.length;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const scriptSchema = z.object({
  narrator: z.object({ gender: z.enum(["male", "female"]), age: z.number() }),
  characters: z.array(z.object({ name: z.string(), gender: z.enum(["male", "female"]), age: z.number() })),
  turns: z.array(z.object({ speaker: z.string(), style: z.string(), text: z.string() })),
});

const TAGS = "<sigh> <sob> <cry> <breath> <exhales> <gasp> <whispers> <short pause> <long pause> <chuckle> <whimper>";

/** AI dựng kịch bản đọc. Không giữ đúng chữ truyện → null (người gọi đọc một giọng như cũ). */
export async function directScript(content: string): Promise<Script | null> {
  const script = await textProvider().generateJson({
    system: "You are an audiobook director casting and directing a Vietnamese emotional family-drama story told in first person ('tôi').",
    prompt: `Chia truyện dưới đây thành các LƯỢT ĐỌC theo đúng thứ tự, phủ TOÀN BỘ văn bản, KHÔNG sửa, KHÔNG bỏ, KHÔNG thêm chữ nào của truyện.
- speaker: "${NARRATOR}" cho lời kể của nhân vật "tôi" (kể cả khi "tôi" nói thoại); tên nhân vật cho lời thoại của nhân vật đó (chỉ phần trong lời thoại; phần dẫn "– Khoa nói" vẫn thuộc ${NARRATOR}).
- style: tiếng Anh ≤ 8 từ, cảm xúc + nhịp của lượt đó (vd "speaking slowly, holding back tears", "cold, dismissive, impatient", "warm, gentle, very slow", "trembling, choked up"). Người kể luôn chậm rãi, có ngừng nghỉ.
- text: nguyên văn đoạn đó; được CHÈN thẻ hơi thở bằng tiếng Anh trong ngoặc nhọn ở chỗ thật sự xúc động (tối đa 1 thẻ / 2–3 câu): ${TAGS}. Không thẻ nào khác.
- Lượt người kể dài tối đa ~6 câu; đổi cảm xúc thì tách lượt mới.
- narrator: giới tính + tuổi của "tôi". characters: mọi nhân vật có lời thoại (tên đúng như speaker), giới tính, tuổi ước lượng.

TRUYỆN:
${content}`,
    schema: scriptSchema,
    maxOutputTokens: 32000,
    temperature: 0.3,
    tier: "quality",
    task: "story",
  });
  const turns = script.turns.filter((t) => stripTags(t.text));
  if (!faithful(content, turns)) return null;
  return { ...script, turns };
}
