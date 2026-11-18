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
export type VoiceTable = Record<Gender, Record<"old" | "mid" | "young", readonly string[]>>;

export function castVoices(s: Pick<Script, "narrator" | "characters" | "turns">, table: VoiceTable = VOICES): Record<string, string> {
  const used = new Set<string>();
  let narrator = "";
  const pick = (g: Gender, age: number) => {
    const order = [...table[g][band(age)], ...Object.values(table[g]).flat()];
    // Hết giọng trống (vd ivoi chỉ 2 giọng nữ thường) → dùng lại, nhưng tránh trùng giọng người kể.
    const v = order.find((x) => !used.has(x)) ?? order.find((x) => x !== narrator) ?? table[g][band(age)][0];
    used.add(v);
    return v;
  };
  const cast: Record<string, string> = { [NARRATOR]: (narrator = pick(s.narrator.gender, s.narrator.age)) };
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
/**
 * Gom lượt cho TTS một-giọng-mỗi-lượt-gọi (ivoi): lượt liền nhau cùng giọng nối thành một đoạn ≤ maxChars, bỏ thẻ hơi thở.
 * ivoi tính tiền theo ký tự nên số lượt gọi không đổi giá — gom chỉ để ít job, ít chỗ nối audio.
 */
export function ivoiSegments(turns: Turn[], cast: Record<string, string>, maxChars: number): { voice: string; text: string }[] {
  const out: { voice: string; text: string }[] = [];
  for (const t of turns) {
    const voice = cast[t.speaker] ?? cast[NARRATOR];
    const text = stripTags(t.text);
    if (!text) continue;
    const last = out.at(-1);
    if (last && last.voice === voice && last.text.length + 1 + text.length <= maxChars) last.text += ` ${text}`;
    else out.push({ voice, text });
  }
  return out;
}

/** Mỗi lượt gọi đạo diễn tối đa ngần này từ: truyện 1 tiếng (~12.000 từ) gửi một lần thì JSON vượt giới hạn đầu ra 32k token. */
export const DIRECT_PART_WORDS = 2500;

// Chương lưu đoạn văn cách nhau bởi xuống dòng (một hoặc hai) — tách theo mọi xuống dòng.
const paragraphs = (t: string) => t.split(/\n+/).map((x) => x.trim()).filter(Boolean);

/** Cắt truyện theo đoạn văn thành các phần ≤ maxWords từ (không cắt giữa đoạn). */
export function splitForDirecting(content: string, maxWords = DIRECT_PART_WORDS): string[] {
  const parts: string[] = [];
  let cur: string[] = [];
  let words = 0;
  for (const para of paragraphs(content)) {
    const w = para.split(/\s+/).length;
    if (cur.length && words + w > maxWords) {
      parts.push(cur.join("\n\n"));
      cur = [];
      words = 0;
    }
    cur.push(para);
    words += w;
  }
  if (cur.length) parts.push(cur.join("\n\n"));
  return parts;
}

/** Ghép kịch bản từng phần: người kể lấy phần đầu, nhân vật gộp theo tên (phần sau không ghi đè phần trước). */
export function mergeScripts(parts: Script[]): Script {
  const characters: Person[] = [];
  for (const p of parts) for (const c of p.characters) if (!characters.some((x) => x.name === c.name)) characters.push(c);
  return { narrator: parts[0].narrator, characters, turns: parts.flatMap((p) => p.turns) };
}

async function directPart(content: string, known: Person[]): Promise<Script | null> {
  const script = await textProvider().generateJson({
    system: "You are an audiobook director casting and directing a Vietnamese emotional family-drama story told in first person ('tôi').",
    prompt: `Chia ${known.length ? "đoạn truyện" : "truyện"} dưới đây thành các LƯỢT ĐỌC theo đúng thứ tự, phủ TOÀN BỘ văn bản, KHÔNG sửa, KHÔNG bỏ, KHÔNG thêm chữ nào của truyện.
- speaker: "${NARRATOR}" cho lời kể của nhân vật "tôi" (kể cả khi "tôi" nói thoại); tên nhân vật cho lời thoại của nhân vật đó (chỉ phần trong lời thoại; phần dẫn "– Khoa nói" vẫn thuộc ${NARRATOR}).
- style: tiếng Anh ≤ 8 từ, cảm xúc + nhịp của lượt đó (vd "speaking slowly, holding back tears", "cold, dismissive, impatient", "warm, gentle, very slow", "trembling, choked up"). Người kể là người già từng trải: nhịp kể tự nhiên, cảm xúc rõ (nghẹn, run, uất, nhẹ nhõm…) đổi theo từng đoạn, KHÔNG đều đều.
- text: nguyên văn đoạn đó; được CHÈN thẻ hơi thở bằng tiếng Anh trong ngoặc nhọn ở chỗ thật sự xúc động (tối đa 1 thẻ / 2–3 câu): ${TAGS}. Không thẻ nào khác.
- Lượt người kể dài tối đa ~6 câu; đổi cảm xúc thì tách lượt mới.
- narrator: giới tính + tuổi của "tôi". characters: mọi nhân vật có lời thoại (tên đúng như speaker), giới tính, tuổi ước lượng.${
      known.length ? `\n- Đây là một đoạn giữa truyện. Nhân vật đã xuất hiện ở các đoạn trước — người nào nói lại thì dùng ĐÚNG tên này làm speaker: ${known.map((c) => `${c.name} (${c.gender}, ${c.age})`).join(", ")}.` : ""
    }

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

/**
 * AI dựng kịch bản đọc, chia phần ≤ DIRECT_PART_WORDS từ cho truyện dài. Phần nào AI không giữ đúng chữ thì phần đó
 * đọc bằng giọng người kể (không bỏ cả kịch bản); không phần nào dựng được → null (người gọi đọc một giọng như cũ).
 */
export async function directScript(content: string): Promise<Script | null> {
  const chunks = splitForDirecting(content);
  const parts: (Script | null)[] = [];
  for (const chunk of chunks) {
    const known = parts.flatMap((p) => p?.characters ?? []);
    parts.push(await directPart(chunk, known));
  }
  const ok = parts.filter((p): p is Script => p != null);
  if (!ok.length) return null;
  return mergeScripts(parts.map((p, i) => p ?? { narrator: ok[0].narrator, characters: [], turns: paragraphs(chunks[i]).map((text) => ({ speaker: NARRATOR, style: "", text })) }));
}
