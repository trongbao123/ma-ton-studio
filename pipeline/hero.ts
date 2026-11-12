// Ảnh mẫu nam chính CỐ ĐỊNH cho cả bộ truyện: trước đây mỗi chương AI tự viết lại ngoại hình + không có ảnh để bám
// → cùng một nhân vật mỗi cảnh một mặt. Giờ: mô tả + ảnh mẫu lưu 1 lần trong app_settings, mọi cảnh có nam chính vẽ kèm ảnh mẫu.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, type Series } from "@/db/schema";
import { ffmpeg } from "./ffmpeg";
import { drawImage } from "./images";
import { ART_STYLE, characterLookFor } from "./prompts";

export type HeroRef = { look: string; file: string | null };
type Stored = { look: string; jpg?: string };

export const heroKey = (seriesId: number) => `hero_ref_${seriesId}`;

/** Prompt ảnh mẫu: toàn thân + mặt rõ, nền trơn — để model chỉ học nhân vật, không học bối cảnh. */
export const heroPrompt = (look: string) =>
  `${ART_STYLE}. Character reference sheet of ONE young man: ${look}. Full body standing front view, face clearly visible and well lit, calm expression, plain soft grey background, no other people, no text`;

/**
 * Mô tả + ảnh mẫu nam chính của bộ truyện (ghi file vào `dir`). Chưa có thì tạo và lưu. Lỗi vẽ ảnh mẫu (hết lượt…)
 * thì vẫn trả mô tả cố định (file = null) — video vẫn ra, chỉ không có ảnh tham chiếu.
 */
export async function heroRef(s: Series, dir: string): Promise<HeroRef> {
  const file = path.join(dir, "hero-ref.jpg");
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, heroKey(s.id)));
  const stored = (row?.value ?? null) as Stored | null;
  const look = stored?.look || (await characterLookFor(s)).characterLook;
  if (stored?.jpg) {
    await writeFile(file, Buffer.from(stored.jpg, "base64"));
    return { look, file };
  }
  let jpg: string | undefined;
  try {
    const raw = path.join(dir, "hero-ref-raw.jpg");
    await drawImage(heroPrompt(look), raw, { width: 1280, height: 768, seed: 7 });
    // Thu nhỏ còn ~100–200 KB để lưu jsonb.
    await ffmpeg(["-i", raw, "-vf", "scale=1024:-2", "-q:v", "4", "-frames:v", "1", file]);
    jpg = (await readFile(file)).toString("base64");
  } catch (e) {
    console.warn("⚠ Chưa vẽ được ảnh mẫu nam chính — dùng mô tả cố định:", e instanceof Error ? e.message.slice(0, 200) : e);
  }
  const value: Stored = { look, ...(jpg ? { jpg } : {}) };
  await db().insert(appSettings).values({ key: heroKey(s.id), value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  return { look, file: jpg ? file : null };
}
