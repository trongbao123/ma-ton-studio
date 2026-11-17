// Thể loại "Chuyện đời" (kênh Chuyện Đời Lắng Đọng): mỗi chương là MỘT câu chuyện độc lập trọn vẹn 8–12 phút cho khán giả
// trung niên — gia đình, hôn nhân, tình cha mẹ, nhân quả. Khác hẳn tiên hiệp: không bàn tay vàng, không cảnh giới, không cliffhanger.
// Mọi nhánh "nếu là chuyện đời" trong prompt viết/meta/ảnh đọc từ file này.
import type { Chapter, Series } from "@/db/schema";

export const LIFE_GENRE = "Chuyện đời";
export const isLifeStory = (s: Pick<Series, "genre"> | null | undefined) => s?.genre === LIFE_GENRE;

/** ~2.300 từ ≈ 10–11 phút sau tăng tốc giọng (1.700 từ chỉ ~7,5 phút và phải nhồi kết → kết bị cụt). */
export const LIFE_TARGET_WORDS = 2300;

/** Nhịp dựng của kênh (kế hoạch thử 4 tuần, 11/2026) — dùng cho cả người viết lẫn biên tập. */
export const LIFE_PACING = [
  // Chủ kênh 17/11/2026: mở bằng câu thoại trơ trọi nghe cụt; kể ngôi thứ ba kiểu tóm tắt thì "đéo có cảm xúc" → kể ngôi "tôi".
  "0–20 giây đầu (≈ 70–90 từ): NHÂN VẬT CHÍNH tự giới thiệu và tóm cả nỗi đau theo khuôn 'Tôi năm nay … tuổi. Tôi đã hy sinh gì (có con số) → vậy mà giờ tôi gặp chuyện gì đau nhất (hình ảnh cụ thể: ngồi ở bến xe với chiếc vali, đứng ngoài cổng cưới con…) → một câu úp mở về bước ngoặt (KHÔNG nói ra lời giải)'. Câu đầu tự hiểu được khi nghe riêng. Không chào hỏi, không giới thiệu kênh, không tả thời tiết.",
  "Ngay sau đó: 'Chuyện bắt đầu từ…' rồi vào cảnh biến cố đầu tiên; câu thoại nào cũng rõ ai nói với ai. Trong ~200 từ tiếp người nghe biết tôi đã hy sinh gì và tôi CÓ NGUY CƠ MẤT gì.",
  "ĐỘNG CƠ CẢM XÚC chính: mỗi lần bị đối xử tệ, đặt NGAY cạnh một KÝ ỨC HY SINH cụ thể gắn với một đồ vật/khoảnh khắc (bán nhẫn cưới mua xe cho con, cõng con sốt đi trạm xá giữa đêm, nhịn bữa để con có quả trứng, lời hứa của con ngày xưa) — người nghe đau vì sự tương phản 'ngày ấy – bây giờ'.",
  "Bậc thang tổn thương: ít nhất 3 lần bị làm đau, lần sau đau hơn lần trước; mỗi lần có một CÂU NÓI tàn nhẫn cụ thể nhân vật chính nghe tận tai ('Bà ở đâu chẳng được, miễn đừng ở đây', 'đến lượt thằng Dũng'), và một khoảnh khắc chờ đợi bị dập tắt (chờ con bênh một câu mà nó im lặng). Xen một chút tử tế nhỏ của người dưng/đứa trẻ để làm nổi nỗi đau.",
  "Cho người nghe ở TRONG đầu nhân vật: suy nghĩ thật, tự hỏi, tự trách ('Tôi lấy tư cách gì mà gõ cổng nhà người ta?'), cảm giác cơ thể (tay bám vào tường, cổ họng nghẹn, ổ bánh mì nóng trong tay mà nước mắt cứ chảy). Thỉnh thoảng nói với người nghe ('Các bạn biết không, lúc ấy tôi không thấy giận…'). KHÔNG kể tóm tắt kiểu 'bà hiểu, chỉ gật đầu' — dựng thành cảnh có thoại.",
  "Khoảng 2/3 truyện có BƯỚC NGOẶT bất ngờ nhưng hợp lý (sự thật bị giấu, người tưởng xấu hoá ra tốt, người dưng đã âm thầm giúp) — gieo chi tiết báo trước từ nửa đầu (cây khế, lời nói tưởng đùa).",
  "KẾT (≈ 1/4 cuối, KHÔNG được vội) đủ 4 nhịp: (1) màn đối mặt — kẻ có lỗi đứng trước nhân vật chính, nhận ra lỗi qua một chi tiết cụ thể khiến họ chết lặng (tin nhắn chỉ thả ngón tay cái lúc 3 giờ sáng…); (2) nhân vật chính nói 2–3 câu bình thản mà thấm, người nghe phải nghẹn; (3) 'Mùa xuân năm sau…' / 'Từ đó…': số phận từng người được khép rõ theo nhân quả, người sai thay đổi bằng hành động cụ thể, không bỏ lửng ai; (4) 2–3 câu nhân vật nói với người nghe một cách ấm áp (KHÔNG giảng đạo lý kiểu 'câu chuyện cho ta thấy'), câu cuối là câu hỏi mời người nghe kể chuyện của mình ở phần bình luận.",
];

/** Trích bản mẫu chủ kênh đã duyệt (truyện 1, viết lại 17/11/2026) — cho AI thấy giọng, không chép nội dung. */
export const LIFE_EXEMPLAR = `Tôi năm nay năm mươi lăm tuổi. Tôi có ba đứa con, đứa nào cũng học hành đến nơi đến chốn, đứa nào cũng có nhà cửa đàng hoàng. Vậy mà có một đêm mưa tháng Mười, tôi ngồi co ro ở bến xe với chiếc vali cũ, lục túi chỉ còn ba trăm nghìn, và tôi không biết mình nên về đâu. Ba đứa con, ba cánh cửa, không cánh cửa nào mở cho mẹ nó. Tôi chỉ không ngờ, ở cái nơi tôi tưởng đã mất từ lâu, lại có một người đứng mở cổng chờ tôi suốt ba năm.
[…]
Các bạn biết không, lúc ấy tôi không thấy giận. Tôi chỉ thấy lạ. Tôi nhìn thằng con trai mình, cái thằng hồi bé sốt bốn mươi độ, tôi cõng nó đi bộ năm cây số ra trạm xá giữa đêm, vừa đi vừa khóc vì sợ nó chết. Giờ nó đứng đó, cao hơn tôi cả cái đầu, và nó không nhìn mẹ nó lấy một lần.
[…]
Tôi chờ. Tôi chờ thằng út nói một câu. Chỉ cần một câu thôi: "Đó là mẹ anh." Nhưng trong buồng im lặng.`;

const LIFE_WRITER_SYSTEM = `Bạn là người viết truyện audio "chuyện đời" tiếng Việt cho khán giả trung niên 35–60 tuổi trên YouTube: chuyện gia đình, tình cha mẹ – con cái, hôn nhân, mẹ chồng – nàng dâu, anh em tranh chấp, nhân quả, bước ngoặt tuổi trung niên. Mục tiêu số một: người nghe NGHẸN, xót, rồi được giải toả — nghe hết không bỏ.
Truyện HOÀN TOÀN HƯ CẤU: không trình bày như sự kiện có thật ("chuyện có thật", "vụ việc ở tỉnh X"), không dùng tên người thật, địa chỉ, công ty, bệnh viện có thật.
NHỊP KỂ VÀ CẢM XÚC (bắt buộc):
- ${LIFE_PACING.join("\n- ")}
CÁCH VIẾT CHO TAI NGHE:
- Kể NGÔI THỨ NHẤT: nhân vật chính xưng "tôi", như đang tâm sự với người nghe; con cái gọi bằng "thằng Khoa", "con Linh"… đúng giọng người Việt trung niên.
- Bối cảnh Việt Nam hiện nay, chi tiết đời thường cụ thể: bữa cơm, xe máy, tiền chợ, căn nhà cấp bốn, tin nhắn Zalo, bến xe. Xưng hô đúng vai vế.
- Thoại chiếm khoảng 1/3: ngắn, mỗi người một giọng. Câu ngắn ở chỗ đau, dễ đọc to. Không sến kiểu "nước mắt lăn dài trên gò má", không lặp cùng một hình ảnh.
- Mỗi truyện tối đa 6 nhân vật có tên, tên Việt bình thường.
- Không bạo lực ghê rợn, không tình dục, không xúc phạm vùng miền/tôn giáo; kẻ sai được quyền hối hận.
- Không ký hiệu, chú thích, markdown, tiêu đề phụ.
- Mỗi chương là một truyện trọn vẹn với nhân vật riêng — KHÔNG nhắc tới các truyện khác, KHÔNG "còn tiếp", KHÔNG cliffhanger.
GIỌNG MẪU (chỉ học giọng, KHÔNG chép nội dung):
${LIFE_EXEMPLAR}`;

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

Độ dài khoảng ${s.targetWords} từ (≈ 10–11 phút đọc). Dành khoảng 1/4 cuối cho phần KẾT đủ 4 nhịp — thà rút ngắn phần giữa chứ không được kết vội. Chỉ trả về nội dung truyện, không lặp tiêu đề, không lời bình.
Trước khi viết, tự lên (trong đầu, KHÔNG in ra) 8–10 nhịp: mỗi nhịp một cảnh có thoại + một ký ức hy sinh đối chiếu + mức đau tăng dần. Chia 6–8 cảnh liền mạch. Đi hết từ đoạn tự giới thiệu mở đầu tới kết thúc trọn vẹn trong lượt này.`,
  };
}

/** Viết tiếp khi AI trả thiếu độ dài: phải đi tới KẾT trọn vẹn (không cliffhanger). */
export function lifeContinueTask(remaining: number) {
  return `Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${remaining} từ, đi hết cốt truyện: bước ngoặt rồi phần KẾT đủ 4 nhịp (đối mặt, lời nhân vật chính, "một năm sau" khép số phận từng người, người kể khép lại + câu hỏi cho người nghe). Không lặp đoạn đã viết, không tóm tắt.`;
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
  "Kể ngôi thứ nhất (nhân vật chính xưng 'tôi', như tâm sự với người nghe), chậm rãi, ấm; thoại ngắn, chi tiết đời thường; cảm xúc qua ký ức và hành động, không sến";

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
