import { z } from "zod";
import type { Chapter, Series } from "@/db/schema";
import { isLifeStory, lifeChapterPrompt, lifeContinueTask, lifeOutlinePrompt } from "./life";

/** Số chương gần nhất đưa nguyên tóm tắt vào prompt; xa hơn thì bỏ để prompt không phình. */
export const RECENT_SUMMARY_WINDOW = 15;

/** Phần của chương trước mà prompt dùng làm trí nhớ — đủ để không phải kéo cả nội dung chương về. */
export type RecalledChapter = Pick<Chapter, "number" | "title" | "summary">;

/**
 * Luật 300 từ đầu chương — rút từ phụ đề các video tu tiên hàng trăm nghìn view (11/2026): video hit vào thẳng thoại/xung đột,
 * nói ra bàn tay vàng trong 20 giây; kênh mình đọc tên chương + tả cảnh nên mất 40% người nghe ở giây 10–20.
 * Biên tập viên AI (editor.ts) chấm đúng danh sách này.
 */
export const OPENING_RULES = [
  "Câu đầu tiên là lời thoại xung đột, lời thông báo của bàn tay vàng, hoặc một câu nêu điều khác biệt — dưới 20 từ; KHÔNG tả cảnh, thời tiết, tên truyện, tên chương.",
  "Trong 300 từ đầu có xung đột trực tiếp giữa người với người (sỉ nhục, đe doạ, thách thức).",
  "Trong 300 từ đầu nhắc tới bàn tay vàng của nhân vật chính và hứa hẹn sức mạnh của nó.",
  "Trong 300 từ đầu có một câu hỏi tò mò nói thành lời (nhân vật hỏi, hoặc người kể hỏi người nghe).",
  "Hai phút đầu (≈300 từ) lời thoại chiếm hơn một nửa; không quá 2 câu tả cảnh liền nhau.",
  "Câu tả cảnh ≤ 15 từ, tối đa 1 hình ảnh so sánh (\"như…\") mỗi đoạn; không chồng tính từ.",
];

/** Ngôi kể "Ta" — mọi video top cùng ngách (Tiểu Hồ Review 50–390k view/video, Panda Tu Tiên 1M) đều kể ngôi thứ nhất. */
export const FIRST_PERSON_STYLE =
  "Kể ngôi thứ nhất: người kể chính là nhân vật chính, xưng 'ta' (lời kể và suy nghĩ đều là 'ta'); người khác gọi hắn bằng tên, 'ngươi', 'tiểu tử'… " +
  "Nhịp nhanh như kể lại truyện: được nhảy thời gian ngắn ('Ba ngày sau…') để tới ngay điểm sướng kế tiếp; thoại nhiều, câu ngắn; " +
  "lời bàn tay vàng/hệ thống là câu ngắn theo khuôn cố định, có con số.";

/**
 * Tập 1 (~1 giờ đầu) quyết định người nghe có theo bộ không. Khuôn hook rút từ phụ đề 4 phút đầu của 4 video top
 * Tiểu Hồ Review (252–387k view): thoại cao trào → "Ta tên X" + tiền truyện nén mỗi câu một biến cố → hạn chót + chênh lệch sức mạnh bằng số.
 */
export const FIRST_HOUR_CHAPTERS = 3;
export const FIRST_HOUR_RULES = [
  "Chương 1 mở bằng 1–3 câu THOẠI ngay giữa cao trào (kẻ thù đòi giao người, cáo buộc phản bội, đám đông chế giễu kèm con số) — không lời kể, không tả cảnh.",
  "Ngay sau đó (≈ giây 15–30): 'Ta tên …' rồi kể NÉN tiền truyện ở ngôi 'ta', 6–10 câu, MỖI CÂU MỘT BIẾN CỐ (bị vứt bỏ, bị sỉ nhục là phế vật, bị phản bội, bàn tay vàng kích hoạt, trả thù lần đầu…) — một phút đi hết một arc bi kịch, không giải thích thế giới.",
  "Quay về hiện tại bằng một HẠN CHÓT + chênh lệch sức mạnh nói bằng con số ('ba canh giờ', 'đại đế với chuẩn đế cách một trời một vực', '10 vạn năm'), rồi hé một tia hy vọng gắn với bàn tay vàng.",
  "Trong chương 1 phải có một màn vả mặt TRỌN VẸN kẻ sỉ nhục ban đầu trước đám đông — không để dành sang chương sau.",
  "Chương 1–3: cứ khoảng 400 từ (≈ 3 phút nghe) một điểm sướng: phần thưởng có con số, vả mặt, lật kèo, lộ sức mạnh khiến đám đông chết lặng.",
  "Thông tin thế giới (cảnh giới, thế lực) chỉ lộ qua thoại hoặc hành động, mỗi lần 1 câu; cấm đoạn văn giới thiệu bối cảnh.",
  "Mỗi chương đối thủ mạnh hơn một bậc; cuối chương 3 (hết tập 1) lộ một bí ẩn lớn về bàn tay vàng hoặc thân thế để người nghe bấm tập 2.",
];

const firstHourBlock = (numbers: number[]) =>
  numbers.length ? `TẬP 1 (chương ${numbers.join(", ")}) — 1 GIỜ ĐẦU PHẢI CUỐN, bắt buộc:\n- ${FIRST_HOUR_RULES.join("\n- ")}` : "";

const WRITER_SYSTEM = `Bạn là tác giả truyện audio tiên hiệp tiếng Việt top đầu YouTube, lối kể của dòng truyện "hệ thống" / sảng văn hàng trăm nghìn lượt nghe: nhân vật chính có một bàn tay vàng đặc biệt được nói ra ngay từ đầu, phần thưởng đo được (con số tăng, kỹ năng mở khoá, vật phẩm) xuất hiện đều đặn, thoại nhiều, câu ngắn, xung đột liên tục, vả mặt kẻ khinh thường trước đám đông.
Truyện dùng để đọc thành audio trên YouTube, người nghe bỏ đi nếu chán 10 giây, nên:
MỞ ĐẦU CHƯƠNG (300 từ đầu quyết định người nghe ở lại):
- ${OPENING_RULES.join("\n- ")}
- Cứ khoảng 600–800 từ có một lần nhân vật chính được thưởng (con số tăng, kỹ năng mở khoá, vật phẩm) hoặc một cú lật.
- Mỗi chương phải có ít nhất một "điểm sướng": thăng cấp, vả mặt kẻ khinh thường, lộ bí mật, đoạt bảo vật, thắng trận trước mặt đám đông.
- Sức mạnh đo được bằng con số và cấp bậc rõ (cảnh giới gì, tầng mấy, pháp bảo phẩm gì); người nghe phải thấy nhân vật mạnh lên từng chút.
- Chiêu thức có tên riêng kêu, mô tả bằng âm thanh, ánh sáng, cảm giác; trận đấu có phản đòn, lật kèo, cái giá phải trả.
- Phản ứng đám đông: kinh ngạc, hít khí lạnh, im phăng phắc — để khuếch đại khoảnh khắc nhân vật chính toả sáng.
- Nhiều thoại ngắn sắc, có cá tính; xen suy nghĩ nội tâm của nhân vật chính. Có tình huynh đệ, đồng đội, tình cảm, mối thù để người nghe gắn bó.
- Giọng kể lôi cuốn như người kể chuyện đang hào hứng, xen chút dí dỏm cho nhẹ nhàng; nhân vật chính bình tĩnh, mưu trí, ra tay quyết đoán, thoại ngắn sắc; lúc đánh nhau và lúc cảm động thì nghiêm túc, căng thẳng.
- Tạo kích thích liên tục: úp mở bí mật, đặt câu hỏi cho người nghe ("Các vị đoán xem, hắn đã làm gì?"), đẩy nguy hiểm lên rồi mới lật kèo.
- Câu ngắn, nhịp nhanh, dễ đọc to; không ký hiệu, chú thích, bảng, markdown.
VIẾT CHO TAI NGHE (người nghe không lật lại được trang trước):
- KHÔNG quay ngược thời gian ở đầu chương ("phải lùi lại một chút", hồi tưởng dài) — mạch truyện đi thẳng về phía trước; chuyện cũ chỉ nhắc 1 câu khi cần.
- Mỗi chương tối đa 2 tên riêng MỚI (người, chiêu, bảo vật, địa danh); tên mới giới thiệu kèm một câu giải thích dễ hiểu. Tên cũ nhắc lại kèm vai trò ("Lãnh Cực, sư phụ của hắn,…") nếu lâu chưa xuất hiện.
- Cứ khoảng 600–800 từ (≈ 4–5 phút nghe) phải có một biến cố: đòn đánh, lời đe doạ, bí mật lộ ra, quyết định khó — không để 2 cảnh liền nhau chỉ nói chuyện/suy nghĩ.
- Chương nào cũng phải có đánh nhau hoặc đối đầu căng thẳng có thắng thua rõ; cảnh nói chuyện phải có xung đột ngầm (doạ, mặc cả, lừa).
- CẢM XÚC là xương sống: tình thân (người nhà hy sinh, lời hứa bảo vệ), tình đồng đội sống chết, tình yêu day dứt, phản bội đau đớn, mối thù máu. Viết cảnh cảm động bằng chi tiết nhỏ và hành động, không sến; để người nghe nghẹn họng, nổi da gà.
- Cao trào xây theo bậc: dồn ép nhân vật chính vào tuyệt cảnh → mất mát → bùng nổ lật ngược thế cờ trước mặt mọi người. Gieo phục bút từ sớm và thu lại bằng cú twist bất ngờ nhưng hợp lý.
- Kết chương bằng cliffhanger buộc người nghe bấm chương sau.
- Giữ đúng tên, cấp bậc, thế lực trong story bible; không mâu thuẫn chương trước.
- Tự sáng tác hoàn toàn: được dùng mô-típ của thể loại nhưng KHÔNG dùng tên nhân vật, địa danh, tông môn hay tình tiết riêng của truyện đã xuất bản.`;

export const bibleSchema = z.object({
  title: z.string().describe("Tên truyện hấp dẫn, 3–8 chữ"),
  premise: z.string().describe("Tóm tắt cốt truyện 3–5 câu"),
  bible: z
    .string()
    .describe("Story bible: nhân vật chính/phụ/phản diện, hệ thống cảnh giới, thế lực, bối cảnh, tuyến truyện lớn"),
  style: z.string().describe("Giọng văn, ngôi kể, nhịp truyện"),
});
export type BibleDraft = z.infer<typeof bibleSchema>;

/**
 * Công thức khiến Thôn Phệ Tinh Không, Đấu La Đại Lục, Quang Âm Chi Ngoại hút người đọc — chỉ lấy CẤU TRÚC và mô-típ chung của thể loại
 * (không ai giữ bản quyền), ghép thành bộ mới. Không bám cốt truyện/nhân vật/hệ thống riêng của bộ nào: vừa là phóng tác trái phép,
 * vừa dễ dính gậy bản quyền YouTube, và người nghe ngách này thuộc lòng các bộ đó.
 */
export const HIT_FORMULA = `Khung cấu trúc học từ 3 bộ hit (chỉ học cấu trúc, KHÔNG chép cốt truyện):
- Kiểu Thôn Phệ Tinh Không: thế giới sau một đại biến (quái thú, dị biến, linh khí phục hồi…), sức mạnh đo bằng con số công khai và bảng xếp hạng mà ai cũng biết; nhân vật chính xuất thân bình thường, mạnh lên nhờ khổ luyện + một kỳ ngộ bí mật; thế giới mở rộng từ quê nhà ra vũ trụ/các giới.
- Kiểu Đấu La Đại Lục: nghi lễ thức tỉnh năng lực lúc nhỏ quyết định số phận; mỗi cấp bậc có dấu hiệu bên ngoài nhìn thấy được; học viện + một tiểu đội cố định 5–7 người, mỗi người một vai (tấn công, phòng thủ, hỗ trợ, khống chế, trinh sát) phối hợp với nhau; giải đấu giữa các học viện/thế lực làm sân khấu toả sáng; tình cảm thanh mai trúc mã, tình huynh đệ sống chết.
- Kiểu Quang Âm Chi Ngoại: không khí u ám, sinh tồn ở vùng đất chết chóc; nhân vật chính lạnh lùng, cẩn trọng, tính toán từng bước, ra tay tàn nhẫn khi cần; một bí ẩn rất lớn về nguồn gốc thế giới/thời gian được hé dần qua cả bộ.
Ghép các yếu tố trên thành một bộ MỚI có hệ thống sức mạnh, thế giới, nhân vật, tên gọi của riêng mình. KHÔNG dùng hệ thống đặc trưng riêng của các bộ đó (vd hồn hoàn/hồn cốt, Đường Môn ám khí), KHÔNG dùng tên nhân vật/địa danh/tông môn của chúng, KHÔNG đi lại chuỗi tình tiết của chúng.`;

export function biblePrompt(idea: string, genre: string) {
  return {
    system: WRITER_SYSTEM,
    prompt: `Thiết kế một bộ truyện ${genre} dài kỳ (100+ chương) từ ý tưởng sau:
"${idea}"

Story bible chi tiết, đủ để nhiều chương sau viết nhất quán, gồm:
- Hệ thống TU TIÊN có cảnh giới rõ thứ tự (vd Luyện Khí 1–9 tầng, Trúc Cơ, Kim Đan, Nguyên Anh, Hóa Thần…), mỗi cảnh giới có dấu hiệu đột phá, thọ nguyên, thần thông đặc trưng; pháp bảo, đan dược, công pháp có phẩm cấp.
- "Bàn tay vàng" của nhân vật chính: bí mật thân thế hoặc năng lực độc nhất, hé lộ dần theo từng arc.
- Nhóm đồng đội 4–6 người cá tính khác nhau, đối thủ cùng thế hệ, phản diện lớn phía sau.
- Mỗi arc có một đỉnh cảm xúc (mất người thân/đồng đội, đoàn tụ, phản bội, báo thù) và một trận cao trào; danh sách các phục bút/bí ẩn lớn sẽ được hé lộ ở đâu.
- Các arc lớn nối tiếp, thế giới mở rộng dần (thôn nhỏ → tông môn → châu lục → thượng giới/tinh không), mỗi arc có mục tiêu, bí cảnh, trùm cuối.

${HIT_FORMULA}`,
  };
}

export const outlineSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string(),
        outline: z.string().describe("Dàn ý 4–8 gạch đầu dòng: diễn biến chính, xung đột, cliffhanger cuối chương"),
      }),
    )
    .min(1),
});
export type OutlineDraft = z.infer<typeof outlineSchema>;

/** Chương mở tập trong khoảng dàn ý (tập k chương; khớp isEpisodeOpener khi các tập bắt đầu ở chương 1 + bội k). */
export function openerLine(s: Pick<Series, "episodeChapters">, startAt: number, count: number) {
  const k = s.episodeChapters;
  if (k <= 0) return "";
  const list = Array.from({ length: count }, (_, i) => startAt + i).filter((n) => (n - 1) % k === 0);
  return list.length
    ? `Chương ${list.join(", ")} là chương MỞ ĐẦU TẬP (giữ chân người xem cả tập ~2 giờ): câu đầu tiên là lời thông báo của bàn tay vàng hoặc thoại xung đột, ngay sau đó nêu điều khác biệt của nhân vật chính trong 1–2 câu, dồn 2–3 xung đột leo thang liên tiếp, có một cú lật kèo giữa chương.`
    : "";
}

/** `trends`: đoạn xu hướng khán giả hiện tại (trendsBrief) — có thì lồng vào, không có thì dàn ý như cũ. */
export function outlinePrompt(s: Series, previous: Chapter[], count: number, trends?: string | null) {
  if (isLifeStory(s)) return lifeOutlinePrompt(s, previous, count);
  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  return {
    system: WRITER_SYSTEM,
    prompt: `${storyContext(s, previous)}

Lên dàn ý cho ${count} chương tiếp theo, từ chương ${startAt} đến chương ${startAt + count - 1}.
Mỗi chương đẩy truyện tiến lên, có ít nhất một điểm sướng (thăng cấp, vả mặt, đoạt bảo, thắng trận); cứ 3–5 chương có một bước ngoặt lớn hoặc trận đấu cao trào. Ghi rõ trong dàn ý cấp bậc nhân vật chính thay đổi thế nào.
Mỗi chương phải có ÍT NHẤT MỘT cảnh đánh nhau hoặc đối đầu căng thẳng có thắng thua rõ (ghi rõ trong dàn ý ai đánh ai, ai thắng, cái giá); KHÔNG có chương nào chỉ gồm nói chuyện, suy nghĩ hay di chuyển. Diễn biến đi thẳng về phía trước, không mở chương bằng hồi tưởng.
${openerLine(s, startAt, count)}
${firstHourBlock(Array.from({ length: count }, (_, i) => startAt + i).filter((n) => n <= FIRST_HOUR_CHAPTERS))}${
      trends ? `\n\nXu hướng khán giả hiện tại (từ YouTube) — lồng ghép tự nhiên, không phá mạch truyện:\n${trends}` : ""
    }`,
  };
}

/** Chương dài (≥ ngần này từ) phải viết nhiều lượt: AI một lần chỉ ra được ~3000–4000 từ. */
export const LONG_CHAPTER_WORDS = 5000;
/** Mỗi lượt "viết tiếp" thêm tối đa ngần này từ (chương dài) — lượt dài hơn AI hay tóm tắt, lặp, kết sớm. */
const PART_WORDS = 3000;
export const isLongChapter = (targetWords: number) => targetWords >= LONG_CHAPTER_WORDS;
/** Số lượt "viết tiếp" tối đa tới khi đủ ~80% độ dài mục tiêu. */
// Chuyện đời 17.000 từ: lượt đầu + 4–5 lượt tiếp (~3.000 từ/lượt); 7 lượt chừa chỗ cho lượt AI viết hụt.
export const maxContinues = (targetWords: number) => (targetWords >= 15000 ? 7 : isLongChapter(targetWords) ? 5 : 2);

/** `partial`: chương dài viết nhiều lượt — lượt đầu chỉ viết phần mở đầu, chưa kết chương. */
export function chapterPrompt(s: Series, previous: RecalledChapter[], chapter: Chapter, opts: { partial?: boolean } = {}) {
  // Chuyện đời: mỗi chương một truyện độc lập — không cần trí nhớ các chương trước.
  if (isLifeStory(s)) return lifeChapterPrompt(s, chapter);
  const long = isLongChapter(s.targetWords);
  const length = long
    ? `Chương DÀI khoảng ${s.targetWords} từ, chia 6–8 cảnh liền mạch.${
        opts.partial ? ` Bạn viết theo nhiều lượt: lượt này CHỈ viết phần đầu (khoảng ${PART_WORDS} từ, 2–3 cảnh đầu của dàn ý), dừng ở giữa mạch truyện — KHÔNG kết chương, KHÔNG cliffhanger, KHÔNG tóm tắt.` : ""
      }`
    : `Độ dài khoảng ${s.targetWords} từ.`;
  return {
    system: `${WRITER_SYSTEM}\nGiọng văn của bộ này: ${s.style || "kể ngôi thứ ba, nhịp nhanh"}.`,
    prompt: `${storyContext(s, previous)}

Viết chương ${chapter.number}: "${chapter.title}".
Dàn ý:
${chapter.outline}

${length} Chỉ trả về nội dung chương, không lặp lại tiêu đề, không lời bình.

Cách viết (bắt buộc):
- ${long ? "Chia 6–8 cảnh liền mạch" : "Chia 3–4 cảnh liền mạch"}; mỗi cảnh có mục tiêu, trở ngại và một thay đổi. Không tóm tắt sự kiện — diễn ra trước mắt người nghe.
- Thoại chiếm khoảng 40% cả chương, hơn một nửa ở 300 từ đầu: ngắn, mỗi nhân vật một giọng riêng; xen suy nghĩ nội tâm của nhân vật chính.
- Ít nhất 1 khoảnh khắc cảm xúc thật (mất mát, ân tình, nhớ người thân) và 1 khoảnh khắc "sướng" (lật kèo, vả mặt, đột phá) có phản ứng đám đông.
- Không lặp từ/câu, không sáo rỗng ("khóe miệng nhếch lên", "hít một ngụm khí lạnh") quá 1 lần mỗi chương.
- Câu cuối là cliffhanger cụ thể (một mối nguy, một bí mật vừa lộ), không kết bằng câu tổng kết.${
      chapter.number <= FIRST_HOUR_CHAPTERS ? `\n\n${firstHourBlock([chapter.number])}` : ""
    }`,
  };
}

export function continuePrompt(base: { system: string; prompt: string }, written: string, targetWords: number, life = false) {
  const remaining = Math.max(targetWords - wordCount(written), 500);
  // Chuyện đời (~1 tiếng 30): viết từng hồi, lượt cuối đi tới kết trọn vẹn, không cliffhanger.
  if (life) {
    return {
      system: base.system,
      prompt: `${base.prompt}\n\n# Phần đã viết (${wordCount(written)} từ)\n${written}\n\nTruyện chưa xong. ${lifeContinueTask(wordCount(written), targetWords)}`,
    };
  }
  // Chương dài: còn nhiều thì chỉ viết 1 phần rồi dừng giữa mạch; phần cuối mới đi hết dàn ý + cliffhanger.
  const more = isLongChapter(targetWords) && remaining > PART_WORDS + 500;
  const task = more
    ? `Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${PART_WORDS} từ, đi tiếp các cảnh kế trong dàn ý. Chương CHƯA kết: không cliffhanger, không tóm tắt, không nhắc lại sự kiện đã viết.`
    : `Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${remaining} từ, đi hết dàn ý và kết bằng cliffhanger. Không lặp lại đoạn đã viết, không tóm tắt.`;
  return {
    system: base.system,
    prompt: `${base.prompt}

# Phần đã viết (${wordCount(written)} từ)
${written}

Chương còn quá ngắn. ${task}`,
  };
}

const normalizeParagraph = (p: string) => p.toLowerCase().replace(/\s+/g, " ").trim();

/** Bỏ các đoạn trong phần mới đã có nguyên văn ở phần trước (AI viết tiếp hay chép lại đoạn cuối). Đoạn ngắn (thoại) giữ nguyên. */
export function dropRepeatedParagraphs(written: string, part: string) {
  const seen = new Set(written.split(/\n{2,}/).map(normalizeParagraph).filter((p) => p.length >= 60));
  return part
    .split(/\n{2,}/)
    .filter((p) => !seen.has(normalizeParagraph(p)))
    .join("\n\n")
    .trim();
}

export function wordCount(text: string) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function summaryPrompt(chapter: Pick<Chapter, "number" | "title">, content: string) {
  return {
    system: "Bạn tóm tắt chương truyện để làm trí nhớ cho tác giả viết các chương sau.",
    prompt: `Tóm tắt chương ${chapter.number} "${chapter.title}" trong 4–6 câu. Ghi rõ: sự kiện chính, nhân vật mới, thay đổi cảnh giới/vật phẩm, tình huống treo cuối chương.

${content}`,
  };
}

/** Bối cảnh chung cho mọi prompt: bible + tóm tắt các chương đã viết gần nhất. */
export function storyContext(s: Series, previous: RecalledChapter[]) {
  const recalled = previous
    .filter((c) => c.summary)
    .slice(-RECENT_SUMMARY_WINDOW)
    .map((c) => `Chương ${c.number} — ${c.title}: ${c.summary}`)
    .join("\n");

  return `# Truyện: ${s.title} (${s.genre})
Cốt truyện: ${s.premise}

# Story bible
${s.bible}

# Diễn biến đã viết
${recalled || "(Chưa có chương nào — đây là phần mở đầu.)"}`;
}
