// Thể loại "Chuyện đời" (kênh Chuyện Đời Lắng Đọng): mỗi chương là MỘT câu chuyện độc lập trọn vẹn 8–12 phút cho khán giả
// trung niên — gia đình, hôn nhân, tình cha mẹ, nhân quả. Khác hẳn tiên hiệp: không bàn tay vàng, không cảnh giới, không cliffhanger.
// Mọi nhánh "nếu là chuyện đời" trong prompt viết/meta/ảnh đọc từ file này.
import type { Chapter, Series } from "@/db/schema";

export const LIFE_GENRE = "Chuyện đời";
export const isLifeStory = (s: Pick<Series, "genre"> | null | undefined) => s?.genre === LIFE_GENRE;

/** Khoảng 1.700 từ ≈ 10 phút giọng đọc chậm (8–12 phút theo kế hoạch thử nghiệm). */
export const LIFE_TARGET_WORDS = 1700;

/** Nhịp dựng của kênh (kế hoạch thử 4 tuần, 11/2026) — dùng cho cả người viết lẫn biên tập. */
export const LIFE_PACING = [
  // Chủ kênh 17/11/2026: mở bằng câu thoại trơ trọi ("Mẹ ở tạm bên nhà Linh đi…") nghe cụt, không biết ai nói với ai → bỏ.
  "0–20 giây đầu (≈ 60–80 từ) là ĐOẠN DẪN CỦA NGƯỜI KỂ, không phải thoại: 3–4 câu tóm cả bi kịch theo khuôn 'Hy sinh gì cả đời (có con số) → vậy mà giờ gặp chuyện gì đau nhất → một câu úp mở về bước ngoặt (KHÔNG nói ra lời giải)'. Câu đầu phải tự hiểu được khi nghe riêng: có tên + tuổi + vai (bà Thu 55 tuổi, người mẹ goá…). Vd: 'Nuôi ba đứa con khôn lớn, bán cả căn nhà cho chúng lập nghiệp, vậy mà năm 55 tuổi, bà Thu xách vali đi hết nhà con này sang nhà con khác mà không ai giữ mẹ lại. … Nhưng ở nơi bà tưởng đã mất từ lâu, có một người vẫn mở cổng chờ bà suốt ba năm.' Không chào hỏi, không giới thiệu kênh, không tả thời tiết.",
  "Ngay sau đoạn dẫn: một câu chuyển ('Chuyện bắt đầu vào một buổi sáng…') rồi vào cảnh biến cố; câu thoại đầu tiên PHẢI nói rõ ai nói với ai (– Mẹ ở tạm bên nhà Linh đi – Khoa nói, mắt không rời điện thoại.). Trong ~150 từ tiếp cho biết nhân vật chính đã hy sinh gì và điều họ CÓ NGUY CƠ MẤT (mái nhà, con cái, cuộc hôn nhân, danh dự).",
  "Phần giữa: cứ khoảng 200–250 từ (≈ 1,5 phút nghe) phải có diễn biến MỚI — một lời nói làm đau, một bí mật hé ra, một quyết định, một cuộc chạm mặt. Không để quá 2 đoạn liền chỉ tả hoặc độc thoại.",
  "Khoảng 2/3 truyện có một BƯỚC NGOẶT bất ngờ nhưng hợp lý (sự thật bị giấu, người tưởng xấu hoá ra tốt, cái giá của lựa chọn cũ) — gieo chi tiết báo trước từ nửa đầu.",
  "Đoạn cuối: giải quyết dứt điểm mâu thuẫn và để lại một hình ảnh cụ thể gợi cảm xúc (bát cơm, lá thư, chiếc áo cũ). KHÔNG kết bằng bài học đạo đức nói thẳng, KHÔNG 'câu chuyện cho ta thấy…'.",
];

const LIFE_WRITER_SYSTEM = `Bạn là người viết truyện audio "chuyện đời" tiếng Việt cho khán giả trung niên 35–60 tuổi trên YouTube: chuyện gia đình, tình cha mẹ – con cái, hôn nhân, mẹ chồng – nàng dâu, anh em tranh chấp, nhân quả, bước ngoặt tuổi trung niên.
Truyện HOÀN TOÀN HƯ CẤU: không trình bày như sự kiện có thật ("chuyện có thật", "vụ việc ở tỉnh X"), không dùng tên người thật, địa chỉ, công ty, bệnh viện có thật.
NHỊP KỂ (bắt buộc):
- ${LIFE_PACING.join("\n- ")}
CÁCH VIẾT CHO TAI NGHE:
- Bối cảnh Việt Nam hiện nay (thành phố hoặc quê), chi tiết đời thường cụ thể: bữa cơm, xe máy, tiền chợ, căn nhà cấp bốn, tin nhắn Zalo. Xưng hô đúng vai vế (mẹ – con, bà – cháu, anh – chú – thím…).
- Kể ngôi thứ ba, giọng người kể chuyện chậm rãi, ấm, có lúc nói nhỏ với người nghe ("Bà không biết rằng…"); câu vừa phải, dễ đọc to.
- Thoại chiếm khoảng 1/3: ngắn, mỗi người một giọng (người mẹ nhẫn nhịn, đứa con vô tâm, người hàng xóm tốt bụng…). Cảm xúc thể hiện qua hành động và chi tiết nhỏ, không gào khóc sến súng, không lặp "nước mắt lăn dài".
- Mỗi truyện tối đa 5 nhân vật có tên; tên nhân vật là tên Việt bình thường, nhắc kèm vai ("Hạnh, con dâu cả") khi lâu chưa xuất hiện.
- Không bạo lực ghê rợn, không tình dục, không xúc phạm vùng miền/tôn giáo; kẻ sai được quyền hối hận.
- Không ký hiệu, chú thích, markdown, tiêu đề phụ.
- Mỗi chương là một truyện trọn vẹn với nhân vật riêng — KHÔNG nhắc tới các truyện khác, KHÔNG "còn tiếp", KHÔNG cliffhanger.`;

export function lifeWriterSystem(s: Pick<Series, "style">) {
  return `${LIFE_WRITER_SYSTEM}\nGiọng văn của kênh: ${s.style || LIFE_STYLE}.`;
}

export function lifeChapterPrompt(s: Series, chapter: Chapter) {
  return {
    system: lifeWriterSystem(s),
    prompt: `Kênh: ${s.title}
Định hướng kênh:
${s.bible.slice(0, 2000)}

Viết trọn câu chuyện: "${chapter.title}".
Cốt truyện / cảm xúc chính:
${chapter.outline}

Độ dài khoảng ${s.targetWords} từ (≈ 10 phút đọc). Chỉ trả về nội dung truyện, không lặp tiêu đề, không lời bình.
Chia 4–6 cảnh liền mạch; mỗi cảnh có một thay đổi. Đi hết từ biến cố mở đầu tới kết thúc trọn vẹn trong lượt này.`,
  };
}

/** Viết tiếp khi AI trả thiếu độ dài: phải đi tới KẾT trọn vẹn (không cliffhanger). */
export function lifeContinueTask(remaining: number) {
  return `Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${remaining} từ, đi hết cốt truyện: bước ngoặt rồi kết trọn vẹn bằng một hình ảnh cụ thể, không giảng đạo lý. Không lặp đoạn đã viết, không tóm tắt.`;
}

/** Hết cốt truyện đã lên sẵn: nghĩ thêm truyện mới cùng tinh thần, không trùng các truyện đã có. */
export function lifeOutlinePrompt(s: Series, previous: Pick<Chapter, "number" | "title">[], count: number) {
  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  return {
    system: lifeWriterSystem(s),
    prompt: `Kênh: ${s.title}
Định hướng kênh:
${s.bible.slice(0, 2000)}

Các truyện đã có (KHÔNG lặp lại cốt truyện hay tình huống chính):
${previous.map((c) => `- ${c.title}`).join("\n") || "(chưa có)"}

Nghĩ ${count} câu chuyện độc lập MỚI (số ${startAt}–${startAt + count - 1}), mỗi truyện một xung đột gia đình/đời thường rõ ràng, dễ minh hoạ bằng ảnh, hợp người xem 35–60 tuổi; xen kẽ cảm xúc (xót xa, ấm lòng, hối hận, hy vọng).
- title: tiêu đề YouTube theo khuôn của kênh: ${LIFE_TITLE_RULE}
- outline: 4–6 gạch đầu dòng: biến cố mở đầu, nhân vật chính và điều có nguy cơ mất, 2–3 diễn biến, bước ngoặt, kết; dòng cuối "Cảm xúc chính: …".`,
  };
}

/** Khuôn tiêu đề kênh chuyện đời (theo 10 tiêu đề chủ kênh lên kế hoạch 11/2026). */
export const LIFE_TITLE_RULE =
  "khuôn '[hoàn cảnh hy sinh/biến cố có con số cụ thể: tuổi, số năm, số tiền], [vai vế đời thường: Bà Mẹ / Người Cha / Người Vợ / Con Dâu…] [điều bất ngờ bỏ ngỏ]' " +
  "(vd 'Nuôi 3 Con Khôn Lớn, Đến Tuổi 55 Bà Mẹ Không Còn Nơi Để Về', 'Bà Lão Ngày Nào Cũng Đặt Hai Suất Cơm, Sự Thật Khiến Chủ Quán Lặng Người'); " +
  "VIẾT HOA chữ cái đầu mỗi từ như ví dụ; 50–85 ký tự; GIẤU kết quả/sự thật để người xem phải bấm; KHÔNG tên nhân vật, KHÔNG 'có thật', KHÔNG số tập";

/** Chữ thumbnail: 3–6 từ lớn như "MẸ KHÔNG CÒN NHÀ", "LÁ THƯ CUỐI CÙNG". */
export const LIFE_THUMB_TEXT_RULE =
  "3–6 từ IN HOA (tối đa ~22 ký tự) nói thẳng nỗi đau/bí mật của truyện (vd 'MẸ KHÔNG CÒN NHÀ', 'LÁ THƯ CUỐI CÙNG', 'BÍ MẬT 30 NĂM'), KHÔNG lặp nguyên văn tiêu đề, KHÔNG tên nhân vật";

export const LIFE_STYLE =
  "Kể ngôi thứ ba, chậm rãi, ấm áp, có lúc người kể nói nhỏ với người nghe; thoại ngắn, chi tiết đời thường; cảm xúc qua hành động, không sến";

export const LIFE_VOICE_STYLE = "giọng nam trung niên trầm ấm, kể chuyện đời chậm rãi, ngắt nghỉ tự nhiên, lắng xuống ở đoạn xúc động";
/** Giọng Gemini TTS: Charon — nam, trầm, kể chuyện. */
export const LIFE_TTS_VOICE = "Charon";

export const LIFE_BIBLE = `Kênh truyện audio "chuyện đời" — mỗi video là MỘT câu chuyện độc lập trọn vẹn 8–12 phút, nhân vật mới mỗi truyện.
Khán giả: người Việt 35–60 tuổi, nghe khi nấu cơm, lái xe, trước giờ ngủ; thích chuyện gia đình, tình thân, hôn nhân, nhân quả, sự tử tế.
Đề tài chính: hy sinh của cha mẹ và sự vô tâm của con cái; mẹ chồng – nàng dâu; phản bội và tha thứ trong hôn nhân; anh em tranh chấp tài sản; người nghèo tử tế; bắt đầu lại ở tuổi trung niên; bí mật gia đình hé lộ sau nhiều năm.
Bối cảnh: Việt Nam hiện nay, thành phố và nông thôn; đời sống cụ thể (chợ, xe máy, nhà cấp bốn, tiền lương, tin nhắn Zalo).
Mọi truyện là HƯ CẤU, không trình bày như sự kiện có thật.
Tông giọng: lắng đọng, ấm, chân thật; có xót xa nhưng luôn để lại hy vọng hoặc sự thức tỉnh; không giảng đạo lý.`;

export const LIFE_PREMISE =
  "Những câu chuyện đời độc lập về tình cha mẹ, con cái, hôn nhân và những biến cố tuổi trung niên — mỗi video một truyện trọn vẹn, mở bằng biến cố, kết bằng cảm xúc.";

/** 10 truyện thử nghiệm đầu tiên (chủ kênh lên kế hoạch 17/11/2026) — thứ tự đăng = thứ tự ở đây, truyện 1 làm trước. */
export const LIFE_PILOT: { title: string; emotion: string; plot: string }[] = [
  { title: "Nuôi 3 Con Khôn Lớn, Đến Tuổi 55 Bà Mẹ Không Còn Nơi Để Về", emotion: "Xót xa, bất công", plot: "Người mẹ goá tần tảo nuôi 3 con ăn học thành đạt, bán cả nhà để lo cho con; về già lần lượt bị các con đùn đẩy, không nhà nào chịu nhận." },
  { title: "Sau 20 Năm Chung Sống, Người Vợ Phát Hiện Bí Mật Trong Điện Thoại Chồng", emotion: "Phản bội, bất ngờ", plot: "Người vợ vô tình đọc được tin nhắn trong điện thoại chồng sau 20 năm hôn nhân; sự thật phía sau không giống điều chị nghĩ." },
  { title: "Bị Con Dâu Đuổi Ra Khỏi Nhà, Bà Mẹ Chồng Âm Thầm Rời Đi", emotion: "Uất ức, tò mò", plot: "Bà mẹ chồng bị con dâu đuổi khỏi chính căn nhà bà gây dựng; bà lặng lẽ rời đi, mang theo một điều cả nhà không ai biết." },
  { title: "Người Cha Nghèo Đến Dự Đám Cưới Con Gái, Nhưng Không Ai Cho Ông Vào", emotion: "Tủi thân, tình cha", plot: "Người cha nghèo từ quê lên dự đám cưới con gái ở thành phố, bị chặn ngoài cổng vì quần áo lam lũ; con gái phải chọn." },
  { title: "Nhặt Được Chiếc Ví Có 200 Triệu, Người Phụ Nữ Bán Rau Đưa Ra Một Quyết Định", emotion: "Tử tế, ấm lòng", plot: "Người phụ nữ bán rau đang cần tiền chữa bệnh cho con nhặt được chiếc ví 200 triệu; quyết định của chị thay đổi cuộc đời hai gia đình." },
  { title: "Chồng Vừa Mất, Người Vợ Mới Biết Ông Đã Giấu Mình Một Chuyện Suốt 30 Năm", emotion: "Tiếc nuối, xúc động", plot: "Sau đám tang chồng, người vợ phát hiện ông đã âm thầm giữ một bí mật suốt 30 năm — một bí mật vì bà." },
  { title: "Hai Anh Em Tranh Nhau Mảnh Đất, Đến Khi Mẹ Mất Mới Mở Lá Thư Cuối Cùng", emotion: "Day dứt, thức tỉnh", plot: "Hai anh em từ mặt nhau vì mảnh đất hương hoả; ngày mẹ mất họ mới mở lá thư bà để lại." },
  { title: "Bỏ Vợ Nghèo Để Lấy Người Giàu, 10 Năm Sau Người Đàn Ông Trở Về", emotion: "Hối hận, nhân quả", plot: "Người đàn ông bỏ vợ con nghèo khó để cưới con gái nhà giàu; 10 năm sau trắng tay, anh trở về làng cũ." },
  { title: "Bà Lão Ngày Nào Cũng Đặt Hai Suất Cơm, Sự Thật Khiến Chủ Quán Lặng Người", emotion: "Bí ẩn, cảm động", plot: "Một bà lão ngày nào cũng ghé quán cơm bình dân đặt hai suất nhưng chỉ ăn một; chủ quán tò mò tìm hiểu và lặng người trước sự thật." },
  { title: "Tuổi 48 Bị Chồng Bỏ Rơi, Người Phụ Nữ Quyết Định Bắt Đầu Lại", emotion: "Hy vọng, truyền cảm hứng", plot: "Bị chồng bỏ ở tuổi 48, tay trắng và bị chê già, người phụ nữ học lại từ đầu và dựng lại cuộc đời mình." },
];

export const pilotOutline = (p: (typeof LIFE_PILOT)[number]) => `- ${p.plot}\n- Phát triển thành truyện trọn vẹn theo nhịp kênh: biến cố mở đầu → nhân vật và điều có nguy cơ mất → diễn biến liên tục → bước ngoặt → kết lắng đọng.\nCảm xúc chính: ${p.emotion}`;

// ── Ảnh / meta cho render ──────────────────────────────────────────────────────────────────────────────

/** Ảnh minh hoạ: điện ảnh chân thực, người Việt trung niên, ánh sáng ấm — khác hẳn donghua tiên hiệp. */
export const LIFE_ART_STYLE =
  "cinematic film still, realistic photography style, contemporary Vietnam everyday life, Vietnamese people, expressive middle-aged faces with natural skin texture, modest homes, markets, alleys, rural villages, warm soft natural light, gentle melancholic mood, shallow depth of field, 35mm lens, color graded, ultra detailed, no text, no watermark, no nudity";

export const LIFE_META_SYSTEM = "Bạn là chuyên gia YouTube kênh truyện audio chuyện đời / gia đình Việt Nam cho khán giả trung niên, tối ưu CTR và retention.";

export const LIFE_THUMB_PROMPT =
  "English image prompt for a YouTube thumbnail: one or two expressive MIDDLE-AGED Vietnamese faces (close-up, strong clear emotion: grief, shock, quiet tears, regret) at the story's most painful moment, realistic cinematic photo, faces on the LEFT half, darker simpler RIGHT 40% for big text, high contrast, warm dramatic light";

export const LIFE_LOOK_RULE =
  "Contemporary Vietnam: everyday modern clothes (áo bà ba, plain shirt, cardigan, work clothes…) — nothing ancient, no hanfu, no fantasy.";

export const LIFE_SCENES_SYSTEM = "You write prompts for an image model illustrating a realistic contemporary Vietnamese family-drama audio story.";

/** Ít ảnh hơn tiên hiệp: chuyện đời ít hành động, 1 ảnh ~40 giây là đủ (10 phút ≈ 15 ảnh). */
export const LIFE_IMAGE_SECONDS = 40;
export const LIFE_MAX_IMAGES = 18;

/** Từ khóa gốc nghiên cứu vidIQ. */
export const LIFE_SEEDS = ["chuyện đời", "truyện audio cảm động", "câu chuyện cuộc sống"];
