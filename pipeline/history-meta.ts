// Tiêu đề/mô tả/thumbnail cho video kênh lịch sử (historyauto gọi sau khi dựng đạt QC). AI chỉ viết phần tò mò
// (tiêu đề, mô tả tóm tắt, tag, chữ thumbnail) — nguồn Wikipedia + ghi công nhạc (CC BY bắt buộc) + ghi công ảnh
// Commons do CODE tự nối vào cuối mô tả, không để AI tự bịa đường dẫn hay giấy phép. YouTube giới hạn mô tả 5000
// BYTE (không phải ký tự) — cắt theo Buffer.byteLength để tiếng Việt có dấu (nhiều byte/ký tự) không vượt trần.
import { z } from "zod";
import type { Chapter, Series, VideoMeta } from "@/db/schema";
import { textProvider } from "@/lib/ai";
import { wikiTitleOf } from "@/lib/story/history";
import { lifeMusicCredit } from "./render";
import { artCredits, type ArtImage } from "./scene-art";

const HISTORY_META_SYSTEM = `Bạn là chuyên gia SEO YouTube cho kênh phim tài liệu lịch sử tiếng Việt "Sử Ký Kể Chuyện".
Khán giả: người Việt yêu lịch sử, muốn hiểu đúng sử và xem hết vì tò mò.
LUẬT (bắt buộc): chỉ dùng tên người, địa danh, năm tháng, con số, diễn biến CÓ TRONG kịch bản — không thêm chi tiết mới, không bịa.
Tiêu đề/thumbnail: giấu KẾT CỤC của sự kiện (ai thắng/thua, ai sống/chết, trận đánh ra sao) để giữ chân người xem đến cuối,
nhưng được nêu tên nhân vật/sự kiện và con số gây tò mò (năm, quân số, thời gian) — đây là phim tài liệu, không phải truyện hư cấu.
Mô tả: KHÔNG tự ghi nguồn tra cứu hay ghi công ảnh/nhạc — phần đó hệ thống tự thêm vào cuối, không cần bạn viết.`;

export const historyMetaSchema = z.object({
  title: z.string().describe("Tiêu đề YouTube 40–80 ký tự: tò mò, đúng sử, giấu kết cục, có tên sự kiện/nhân vật và một con số hoặc vai vế cụ thể lấy từ kịch bản."),
  description: z.string().describe("Mô tả 2–3 đoạn (150–250 từ): tóm tắt hấp dẫn, không spoil kết cục, không chèn nguồn/ghi công."),
  tags: z.array(z.string()).describe("15–25 tag tiếng Việt CÓ DẤU người xem thật tìm trên YouTube (vd 'lịch sử việt nam', 'phim tài liệu lịch sử'); không trùng nhau."),
  thumbnailText: z.string().describe("Chữ in to trên thumbnail, 2–4 từ, gây tò mò nhưng không lộ kết cục."),
});

export type HistoryMetaInput = { series: Series; chapter: Chapter; images: ArtImage[]; musicFiles: string[] };

/** Trần mô tả thật của YouTube (byte, không phải ký tự). */
const YOUTUBE_DESCRIPTION_BYTE_LIMIT = 5000;
/** Chừa biên dưới trần YouTube cho sai số đo — không bao giờ cố lấp đầy sát trần. */
const DESCRIPTION_BYTE_MARGIN = 100;
const DESCRIPTION_BYTE_BUDGET = YOUTUBE_DESCRIPTION_BYTE_LIMIT - DESCRIPTION_BYTE_MARGIN;
/** Bytes của dấu nối "\n\n" giữa 2 khối khi ghép mô tả. */
const BLOCK_SEPARATOR_BYTES = 2;

/** Cắt chuỗi còn ≤ `maxBytes` byte UTF-8 — slice theo SỐ KÝ TỰ không đủ an toàn vì ký tự tiếng Việt có dấu chiếm 2-3 byte. */
export function truncateToBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), "utf8") > maxBytes) end--;
  return text.slice(0, end);
}

/** Bỏ ảnh trùng trước khi ghi công — storyboard cắt một cảnh thành nhiều shot nên nhiều shot hay dùng lại cùng một ảnh. */
export function dedupeArtImages(images: ArtImage[]): ArtImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = `${image.title}|${image.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Khối ghi công ảnh (dùng lại `artCredits` của scene-art.ts cho đúng khuôn dòng/giấy phép), khử trùng rồi bớt dần
 * số ảnh liệt kê cho vừa `maxBytes`, thêm dòng "… và N ảnh khác" khi phải cắt — danh sách đầy đủ (mỗi shot một
 * dòng, có thể hàng trăm dòng do storyboard cắt nhỏ cảnh) dễ vượt trần mô tả. Giữ 1 ảnh AI (nếu có) trong mọi lượt
 * gọi `artCredits` chỉ để không mất dòng "Minh họa" — ảnh AI không có dòng ghi công riêng.
 */
export function artCreditBlock(images: ArtImage[], maxBytes: number): string {
  const deduped = dedupeArtImages(images);
  const real = deduped.filter((image) => !image.synthetic);
  const syntheticSample = deduped.filter((image) => image.synthetic).slice(0, 1);
  for (let kept = real.length; kept >= 0; kept--) {
    const omitted = real.length - kept;
    const block = artCredits([...real.slice(0, kept), ...syntheticSample]);
    const tail = omitted ? `\n… và ${omitted} ảnh khác (xem nguồn Wikimedia Commons).` : "";
    const full = `${block}${tail}`.trim();
    if (!full || Buffer.byteLength(full, "utf8") <= maxBytes) return full;
  }
  return "";
}

/**
 * Mô tả cuối: tóm tắt của AI + nguồn Wikipedia → ghi công nhạc (CC BY bắt buộc, không bao giờ cắt) → ghi công
 * ảnh (cắt theo ngân sách byte còn lại) — tổng luôn ≤ `DESCRIPTION_BYTE_BUDGET` byte.
 */
export function buildHistoryDescription(aiDescription: string, video: Pick<HistoryMetaInput, "chapter" | "images" | "musicFiles">): string {
  const wikiTitle = wikiTitleOf(video.chapter.outline);
  const wikiLine = wikiTitle ? `Nguồn tư liệu: Wikipedia — "${wikiTitle}"` : "";
  const musicLine = video.musicFiles.length ? lifeMusicCredit(video.musicFiles) : "";
  const mandatory = [wikiLine, musicLine].filter(Boolean).join("\n\n");
  const mandatoryBytes = mandatory ? Buffer.byteLength(mandatory, "utf8") + BLOCK_SEPARATOR_BYTES : 0;
  const summary = truncateToBytes(aiDescription, Math.max(0, DESCRIPTION_BYTE_BUDGET - mandatoryBytes));
  const withoutArt = [summary, wikiLine, musicLine].filter(Boolean).join("\n\n");
  const artBudget = DESCRIPTION_BYTE_BUDGET - Buffer.byteLength(withoutArt, "utf8") - BLOCK_SEPARATOR_BYTES;
  const artBlock = artBudget > 0 ? artCreditBlock(video.images, artBudget) : "";
  return [summary, wikiLine, musicLine, artBlock].filter(Boolean).join("\n\n");
}

/** Tiêu đề/mô tả/tag/chữ thumbnail cho video lịch sử vừa dựng đạt QC; `shortTitle`/`shortDescription` rỗng (kênh không làm Short). */
export async function historyVideoMeta(video: HistoryMetaInput): Promise<VideoMeta> {
  const { series: s, chapter: c } = video;
  const draft = await textProvider().generateJson({
    system: HISTORY_META_SYSTEM,
    prompt: `Kênh: ${s.title}\nĐề tài: ${c.title}\n\nKịch bản:\n${c.content}`,
    schema: historyMetaSchema,
    temperature: 0.7,
    tier: "quality",
    task: "meta",
  });
  return {
    title: draft.title,
    description: buildHistoryDescription(draft.description, video),
    tags: draft.tags,
    shortTitle: "",
    shortDescription: "",
    thumbnailText: draft.thumbnailText,
  };
}

/** Ảnh tư liệu đẹp nhất của video để làm thumbnail: ảnh Commons thật trước, không có ảnh thật mới lùi về ảnh AI; không có ảnh nào → null. */
export function pickThumbnailImage(images: ArtImage[]): string | null {
  return (images.find((image) => !image.synthetic) ?? images[0])?.file ?? null;
}
