// Tiêu đề/mô tả/thumbnail cho video kênh lịch sử (historyauto gọi sau khi dựng đạt QC). AI chỉ viết phần tò mò
// (tiêu đề, mô tả tóm tắt, tag, chữ thumbnail) — nguồn Wikipedia + ghi công ảnh Commons + ghi công nhạc do CODE
// tự nối vào cuối mô tả, không để AI tự bịa đường dẫn hay giấy phép.
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

/** Dòng "Wikipedia: <tiêu đề>" + ghi công ảnh Commons + ghi công nhạc — nối sau phần AI viết, không do AI tạo ra. */
export function historySourcesBlock({ chapter, images, musicFiles }: HistoryMetaInput): string {
  const wiki = wikiTitleOf(chapter.outline);
  const wikiLine = wiki ? `Nguồn tư liệu: Wikipedia — "${wiki}"` : "";
  const artLine = artCredits(images);
  const musicLine = musicFiles.length ? lifeMusicCredit(musicFiles) : "";
  return [wikiLine, artLine, musicLine].filter(Boolean).join("\n\n");
}

/** Tiêu đề/mô tả/tag/chữ thumbnail cho video lịch sử vừa dựng đạt QC; `shortTitle`/`shortDescription` rỗng (kênh không làm Short). */
export async function historyVideoMeta(meta: HistoryMetaInput): Promise<VideoMeta> {
  const { series: s, chapter: c } = meta;
  const draft = await textProvider().generateJson({
    system: HISTORY_META_SYSTEM,
    prompt: `Kênh: ${s.title}\nĐề tài: ${c.title}\n\nKịch bản:\n${c.content}`,
    schema: historyMetaSchema,
    temperature: 0.7,
    tier: "quality",
    task: "meta",
  });
  const sources = historySourcesBlock(meta);
  return {
    title: draft.title,
    description: sources ? `${draft.description}\n\n${sources}` : draft.description,
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
