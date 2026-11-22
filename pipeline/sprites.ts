// Lính giấy 2D và nhân vật trên bản đồ: ảnh do Codex vẽ (nền trong suốt), cache theo prompt để không vẽ lại.
// Vẽ bằng AI thay vì dựng hình bằng SVG — chủ kênh chốt 22/11/2026.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ffmpeg } from "./ffmpeg";
import { drawImage } from "./images";

/** Loại quân cho sprite nhân vật. */
export type SpriteKind = "infantry" | "cavalry" | "elephant" | "general" | "ship" | "cannon";

/** Kiểu vẽ chung: cắt giấy phẳng, nhìn ngang, nền trong suốt — để đặt lên bản đồ. */
export const SPRITE_STYLE =
  "flat 2D paper-cutout game sprite, side view, full body, thick dark outline, muted earthy colors, simple shapes, no text, no background, transparent background, centered, single figure";

const KIND_SUBJECT: Record<SpriteKind, string> = {
  infantry: "a foot soldier marching, holding a spear and a small shield",
  cavalry: "a mounted warrior on a horse, horse walking, rider holding a sabre",
  elephant: "a war elephant walking, with a small wooden howdah on its back",
  general: "a commanding general standing, wearing officer armour, hand raised",
  ship: "a wooden war junk with square sails, seen from the side",
  cannon: "an old bronze cannon on a wooden carriage",
};

/** Ảnh nhỏ hơn ngần này là vẽ hỏng (API trả trang lỗi, ảnh rỗng). */
const MIN_SPRITE_BYTES = 10_000;
/** Sprite vuông, đủ nét khi đặt lên bản đồ 1080p. */
const SPRITE_PX = 768;
/** Seed cố định: cùng loại quân vẽ lại vẫn ra cùng dáng. */
const SPRITE_SEED = 7;
/** Độ lệch màu chấp nhận khi tách nền quanh màu góc ảnh. */
const COLORKEY_SIMILARITY = 0.12;
const COLORKEY_BLEND = 0.04;

/** Loại quân + phe + thời kỳ — đủ để ép AI vẽ đúng sử. */
export type SpriteLook = { kind: SpriteKind; side: string; era: string };

/** Mô tả để AI vẽ một sprite: kiểu vẽ chung + loại quân + phe + thời kỳ (ép đúng sử, cấm chi tiết hiện đại). */
export function spritePrompt({ kind, side, era }: SpriteLook): string {
  return `${SPRITE_STYLE}. Subject: ${KIND_SUBJECT[kind]}. Historical period: ${era}. Faction: ${side}. Period-correct clothing, armour and weapons for that exact time and place; nothing from later centuries, no firearms unless the period had them.`;
}

/** Hàm vẽ ảnh (mặc định Codex qua drawImage) và hàm tách nền — tiêm vào để test không gọi AI. */
export type SpriteDeps = {
  draw?: (prompt: string, outFile: string) => Promise<unknown>;
  cutout?: (file: string) => Promise<void>;
};
export type SpriteSpec = SpriteLook & { dir: string } & SpriteDeps;

/** Tách nền bằng ffmpeg: lấy màu ở góc trên trái làm màu nền rồi khoá màu đó thành trong suốt. */
async function colorkeyCutout(file: string) {
  const keyed = `${file}.keyed.png`;
  await ffmpeg(["-i", file, "-vf", `colorkey=white:${COLORKEY_SIMILARITY}:${COLORKEY_BLEND},format=rgba`, keyed]);
  await rm(file, { force: true });
  await ffmpeg(["-i", keyed, "-c", "copy", file]).catch(async () => {
    const { rename } = await import("node:fs/promises");
    await rename(keyed, file);
  });
  await rm(keyed, { force: true });
}

/** Ảnh sprite cho (loại quân, phe, thời kỳ); đã vẽ rồi thì dùng lại file cũ. */
export async function ensureSprite({ kind, side, era, dir, draw = (p, f) => drawImage(p, f, { width: SPRITE_PX, height: SPRITE_PX, seed: SPRITE_SEED }), cutout = colorkeyCutout }: SpriteSpec): Promise<string> {
  const prompt = spritePrompt({ kind, side, era });
  const id = createHash("sha1").update(prompt).digest("hex").slice(0, 10);
  const file = path.join(dir, `sprite-${kind}-${id}.png`);
  const existing = await readFile(file).catch(() => null);
  if (existing && existing.length >= MIN_SPRITE_BYTES) return file;
  await mkdir(dir, { recursive: true });
  await draw(prompt, file);
  const drawn = await readFile(file).catch(() => null);
  if (!drawn || drawn.length < MIN_SPRITE_BYTES) {
    await rm(file, { force: true });
    throw new Error(`Vẽ sprite ${kind} hỏng (ảnh quá nhỏ hoặc không có)`);
  }
  await cutout(file);
  return file;
}

/** PNG → data URI để nhúng thẳng vào SVG khung bản đồ. */
export async function spriteDataUri(file: string): Promise<string> {
  return `data:image/png;base64,${(await readFile(file)).toString("base64")}`;
}
