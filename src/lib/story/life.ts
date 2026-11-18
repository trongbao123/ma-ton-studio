// Thể loại "Chuyện đời" (kênh Chuyện Đời Lắng Đọng): mỗi chương là MỘT câu chuyện độc lập trọn vẹn ~1 tiếng cho khán giả
// trung niên — gia đình, hôn nhân, tình cha mẹ, nhân quả. Khác hẳn tiên hiệp: không bàn tay vàng, không cảnh giới, không cliffhanger.
// Mọi nhánh "nếu là chuyện đời" trong prompt viết/meta/ảnh đọc từ file này.
import type { Chapter, Series } from "@/db/schema";

export const LIFE_GENRE = "Chuyện đời";
export const isLifeStory = (s: Pick<Series, "genre"> | null | undefined) => s?.genre === LIFE_GENRE;

/**
 * Chủ kênh 18/11/2026: bản 10–14 phút "ngắn quá không ăn thua" → một truyện liền mạch ≥ 1 tiếng, không chia chương.
 * Đo #68/#69 (ivoi, tốc độ gốc): ~177 từ/phút → 12.000 từ ≈ 68 phút (lượt KẾT luôn ≥ 3.000 từ nên tối thiểu ~ 10.800 từ ≈ 61 phút).
 */
export const LIFE_TARGET_WORDS = 12000;
/** Mỗi lượt gọi AI viết ~1 hồi: lượt dài hơn AI hay tóm tắt, lặp, kết sớm. */
export const LIFE_PART_WORDS = 3000;

/**
 * 5 hồi của truyện 1 tiếng (mỗi hồi ≈ 1 lượt viết). Truyện dài giữ người nghe bằng bậc thang biến cố + móc giữ chân cuối mỗi hồi,
 * không phải bằng kể chậm — mỗi hồi phải có ít nhất một sự việc MỚI làm tình thế đổi hẳn.
 */
export const LIFE_ACTS = [
  "HỒI 1 — mở đầu và biến cố: đoạn tự giới thiệu tóm nỗi đau (theo nhịp kênh), rồi 'Chuyện bắt đầu từ…'; dựng gia đình, những hy sinh lớn của tôi qua 2–3 ký ức cụ thể, và biến cố đầu tiên đẩy tôi vào thế có nguy cơ mất điều quan trọng nhất.",
  "HỒI 2 — tổn thương leo thang: 2–3 lần bị làm đau, lần sau đau hơn lần trước, mỗi lần một câu nói tàn nhẫn nghe tận tai và một ký ức hy sinh đối chiếu; một tia hy vọng nhỏ (một người con có vẻ sắp bênh, một cơ hội) rồi bị dập tắt.",
  "HỒI 3 — chạm đáy và một con đường mới: tôi mất thứ cuối cùng còn bám víu (nhà, tiền, chỗ dựa), phải rời đi; gặp người dưng/nơi chốn mới, một chút tử tế; gieo rõ manh mối của bí mật/sự thật sẽ lật ngược câu chuyện.",
  "HỒI 4 — bước ngoặt: sự thật bị giấu hé lộ dần (người tưởng xấu hoá ra tốt, khoản tiền/giấy tờ/lá thư, người dưng đã âm thầm giúp), cán cân đảo chiều; kẻ có lỗi bắt đầu trả giá hoặc tìm đến tôi.",
  "HỒI 5 — KẾT đủ 4 nhịp (không vội): màn đối mặt với chi tiết khiến kẻ có lỗi chết lặng; lời tôi nói bình thản mà thấm; 'một năm sau' khép số phận từng người theo nhân quả; tôi nói với người nghe và câu hỏi mời kể chuyện ở phần bình luận.",
];

/** Lượt viết tiếp này là lượt CUỐI (viết nốt tới KẾT) khi phần còn thiếu vừa một lượt dài — viết xong là truyện đã kết. */
export const lifeIsFinalPart = (written: number, target = LIFE_TARGET_WORDS) => target - written <= LIFE_PART_WORDS * 1.4;

/** Nhịp dựng của kênh (kế hoạch thử 4 tuần, 11/2026) — dùng cho cả người viết lẫn biên tập. */
export const LIFE_PACING = [
  // Chủ kênh 17/11/2026: mở bằng câu thoại trơ trọi nghe cụt; kể ngôi thứ ba kiểu tóm tắt thì "đéo có cảm xúc" → kể ngôi "tôi".
  "0–20 giây đầu (≈ 70–90 từ): NHÂN VẬT CHÍNH tự giới thiệu và tóm cả nỗi đau theo khuôn 'Tôi năm nay … tuổi. Tôi đã hy sinh gì (có con số) → vậy mà giờ tôi gặp chuyện gì đau nhất (hình ảnh cụ thể: ngồi ở bến xe với chiếc vali, đứng ngoài cổng cưới con…) → một câu úp mở về bước ngoặt (KHÔNG nói ra lời giải)'. Câu đầu tự hiểu được khi nghe riêng. Không chào hỏi, không giới thiệu kênh, không tả thời tiết.",
  "Ngay sau đó: 'Chuyện bắt đầu từ…' rồi vào cảnh biến cố đầu tiên; câu thoại nào cũng rõ ai nói với ai. Trong ~200 từ tiếp người nghe biết tôi đã hy sinh gì và tôi CÓ NGUY CƠ MẤT gì.",
  "ĐỘNG CƠ CẢM XÚC chính: mỗi lần bị đối xử tệ, đặt NGAY cạnh một KÝ ỨC HY SINH cụ thể gắn với một đồ vật/khoảnh khắc (bán nhẫn cưới mua xe cho con, cõng con sốt đi trạm xá giữa đêm, nhịn bữa để con có quả trứng, lời hứa của con ngày xưa) — người nghe đau vì sự tương phản 'ngày ấy – bây giờ'.",
  "Bậc thang tổn thương: ít nhất 5 lần bị làm đau trải suốt truyện, lần sau đau hơn lần trước; mỗi lần có một CÂU NÓI tàn nhẫn cụ thể nhân vật chính nghe tận tai ('Bà ở đâu chẳng được, miễn đừng ở đây', 'đến lượt thằng Dũng'), và một khoảnh khắc chờ đợi bị dập tắt (chờ con bênh một câu mà nó im lặng). Xen một chút tử tế nhỏ của người dưng/đứa trẻ để làm nổi nỗi đau.",
  "Cho người nghe ở TRONG đầu nhân vật: suy nghĩ thật, tự hỏi, tự trách ('Tôi lấy tư cách gì mà gõ cổng nhà người ta?'), cảm giác cơ thể (tay bám vào tường, cổ họng nghẹn, ổ bánh mì nóng trong tay mà nước mắt cứ chảy). Thỉnh thoảng nói với người nghe ('Các bạn biết không, lúc ấy tôi không thấy giận…'). KHÔNG kể tóm tắt kiểu 'bà hiểu, chỉ gật đầu' — dựng thành cảnh có thoại.",
  "TRUYỆN DÀI ~1 TIẾNG GIỮ NGƯỜI NGHE: cứ khoảng 1.500 từ phải có một sự việc mới làm tình thế đổi hẳn (không kể lan man, không lặp lại nỗi đau cũ bằng lời khác); cuối mỗi hồi một câu móc úp mở của người kể ('Tôi đâu biết, cái tin nhắn đêm ấy mới là thứ làm tôi mất tất cả'). Có 1–2 tuyến phụ (người dưng tử tế, một người con khác, chuyện cũ của vợ chồng) đan vào tuyến chính.",
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
- Mỗi truyện tối đa 8 nhân vật có tên, tên Việt bình thường.
- Không bạo lực ghê rợn, không tình dục, không xúc phạm vùng miền/tôn giáo; kẻ sai được quyền hối hận.
- Không ký hiệu, chú thích, markdown, tiêu đề phụ.
- Mỗi chương là một truyện trọn vẹn với nhân vật riêng — KHÔNG nhắc tới các truyện khác, KHÔNG "còn tiếp", KHÔNG cliffhanger ở cuối truyện (câu móc úp mở giữa các hồi trong truyện thì nên có).
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

Cả truyện khoảng ${s.targetWords} từ (≈ 1 tiếng nghe), MỘT mạch liền, không chia chương, không tiêu đề phụ. Truyện viết theo nhiều lượt, mỗi lượt một hồi:
${LIFE_ACTS.map((a) => `- ${a}`).join("\n")}

Lượt ĐẦU (lượt này nếu chưa có phần đã viết) CHỈ viết HỒI 1 (khoảng ${LIFE_PART_WORDS} từ, 3–4 cảnh có thoại), dừng ở câu móc cuối hồi — CHƯA kết truyện, không tóm tắt. Chỉ trả về nội dung truyện, không lặp tiêu đề, không ghi "Hồi 1", không lời bình.
Trước khi viết, tự lên (trong đầu, KHÔNG in ra) cả 5 hồi chi tiết: bí mật/bước ngoặt là gì, gieo manh mối ở đâu, mỗi hồi những sự việc mới nào — để các lượt sau đi tiếp không lệch.`,
  };
}

/** Viết tiếp hồi kế: AI tự nhìn phần đã viết để đi tiếp hồi đang dở; lượt cuối (chốt theo số từ còn thiếu) viết nốt tới KẾT. */
export function lifeContinueTask(written: number, target = LIFE_TARGET_WORDS) {
  const common = "Không lặp lại đoạn đã viết, không tóm tắt lại chuyện cũ, không ghi tên hồi; giữ đúng tên, tuổi, chi tiết đã có.";
  if (lifeIsFinalPart(written, target)) {
    const remaining = Math.max(target - written, LIFE_PART_WORDS);
    return `Đã viết ${written}/${target} từ. Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${remaining} từ — đây là lượt CUỐI: viết nốt các hồi còn lại (chưa có bước ngoặt HỒI 4 thì viết cả bước ngoặt) rồi ${LIFE_ACTS[LIFE_ACTS.length - 1]} Truyện phải kết trọn vẹn trong lượt này. ${common}`;
  }
  return `Đã viết ${written}/${target} từ. Xem phần đã viết đang ở hồi nào, rồi viết TIẾP từ đúng chỗ dừng thêm khoảng ${LIFE_PART_WORDS} từ: đi tiếp hồi đang dở hoặc sang hồi kế (không nhảy cóc, không dồn nhiều hồi), có ít nhất một sự việc MỚI làm tình thế đổi hẳn. Dừng ở câu móc cuối hồi — CHƯA kết truyện. ${common}`;
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
- outline: 7–9 gạch đầu dòng cho truyện dài ~1 tiếng: biến cố mở đầu, nhân vật chính và điều có nguy cơ mất, 4–5 diễn biến leo thang (mỗi cái một sự việc mới), bí mật/bước ngoặt, kết; dòng cuối "Cảm xúc chính: …".`,
  };
}

/** Khuôn tiêu đề kênh chuyện đời (theo 10 tiêu đề chủ kênh lên kế hoạch 11/2026). */
export const LIFE_TITLE_RULE =
  "khuôn '[hoàn cảnh hy sinh/biến cố có con số cụ thể: tuổi, số năm, số tiền], [vai vế đời thường: Bà Mẹ / Người Cha / Người Vợ / Con Dâu…] [điều bất ngờ bỏ ngỏ]' " +
  "(vd 'Nuôi 3 Con Khôn Lớn, Đến Tuổi 55 Bà Mẹ Không Còn Nơi Để Về', 'Bà Lão Ngày Nào Cũng Đặt Hai Suất Cơm, Sự Thật Khiến Chủ Quán Lặng Người'); " +
  "VIẾT HOA chữ cái đầu mỗi từ như ví dụ; 50–85 ký tự; GIẤU kết quả/sự thật để người xem phải bấm; KHÔNG tên nhân vật, KHÔNG 'có thật', KHÔNG số tập";

/** Chữ thumbnail: 3–6 từ lớn như "MẸ KHÔNG CÒN NHÀ", "LÁ THƯ CUỐI CÙNG". */
export const LIFE_THUMB_TEXT_RULE =
  "3–6 từ IN HOA (tối đa ~22 ký tự) nói THẲNG xung đột gây sốc giữa NGƯỜI THÂN — có vai vế (MẸ/CON/CHỒNG/VỢ/DÂU) + hành động phũ hoặc con số " +
  "(vd 'BA CON KHÔNG NHẬN MẸ', 'CON DÂU ĐUỔI MẸ ĐI', 'CHỒNG GIẤU 30 NĂM', 'MẸ BÁN NHÀ NUÔI CON'); người lướt đọc 1 giây là hiểu ai làm gì ai và tò mò kết; " +
  "CẤM hình ảnh ẩn dụ/văn vẻ không rõ ai làm gì (vd 'CÁNH CỔNG KHÉP LẠI', 'MÙA THU ẤY'), KHÔNG lặp nguyên văn tiêu đề, KHÔNG tên nhân vật";

export const LIFE_STYLE =
  "Kể ngôi thứ nhất (nhân vật chính xưng 'tôi', như tâm sự với người nghe), chậm rãi, ấm; thoại ngắn, chi tiết đời thường; cảm xúc qua ký ức và hành động, không sến";

export const LIFE_VOICE_STYLE = "giọng nam trung niên trầm ấm, kể chuyện đời chậm rãi, ngắt nghỉ tự nhiên, lắng xuống ở đoạn xúc động";
/** Người kể là người già từng trải: Algenib (Google mô tả "Gravelly" — khàn, có tuổi). Charon nghe trẻ, kiểu đọc tin. */
export const LIFE_TTS_VOICE = "Algenib";
/** Bà mẹ / người vợ có tuổi: Gacrux (Google mô tả "Mature"). Sulafat nghe như phụ nữ trẻ. */
export const LIFE_TTS_VOICE_FEMALE = "Gacrux";

/**
 * Truyện kể ngôi "tôi": đoán giới tính người kể từ cách gọi bạn đời ("chồng tôi" → nữ, "vợ tôi" → nam).
 * Không rõ thì giọng nam mặc định.
 */
export function lifeVoice(content: string, title = "") {
  // Tiêu đề chủ kênh đặt nói thẳng vai người kể ("Bà Mẹ", "Người Vợ", "Người Cha") — tin tiêu đề trước nội dung.
  const t = title.normalize("NFC").toLowerCase();
  const femaleTitle = /bà mẹ|người mẹ|người vợ|con dâu|mẹ chồng|bà lão|người phụ nữ|cô gái|người con gái/.test(t);
  const maleTitle = /người cha|người bố|người chồng|người đàn ông|ông lão|chàng trai/.test(t);
  if (femaleTitle !== maleTitle) return femaleTitle ? LIFE_TTS_VOICE_FEMALE : LIFE_TTS_VOICE;
  const count = (re: RegExp) => (content.match(re) ?? []).length;
  const female = count(/chồng tôi|tôi là mẹ|bà mẹ như tôi|tôi làm dâu|mẹ chồng tôi|người làm mẹ|đứa con tôi đẻ|tôi mang nặng đẻ đau|tôi sinh thằng|tôi sinh con|tôi đi lấy chồng|làm vợ/gi);
  const male = count(/vợ tôi|tôi là bố|tôi là cha|bố vợ tôi|mẹ vợ tôi|người làm cha|tôi lấy vợ/gi);
  return female > male ? LIFE_TTS_VOICE_FEMALE : LIFE_TTS_VOICE;
}

/**
 * Giọng người kể chuyện đời (speech_metadata.style — không bị đọc thành tiếng). KHÔNG "slowly": bản #66 bị đọc
 * ~150 âm tiết/phút nghe lê thê; cảm xúc nằm ở độ ấm/nghẹn, không ở tốc độ.
 */
export const LIFE_NARRATOR_STYLE =
  "an elderly Vietnamese person in their sixties who has lived through hardship, slowly recalling their own life to a grandchild: aged, weathered, slightly husky voice, calm and wise, " +
  "voice softens and chokes up at painful memories; when quoting other people's lines, change tone naturally like real speech (a child's pleading, a harsh word, a sigh) instead of reading them flat; " +
  "natural conversational rhythm, never theatrical, never robotic";

/** Tăng nhẹ tốc độ (giữ cao độ) — đo #66: ~150 âm tiết/phút ở tốc độ gốc, ×1,1 ≈ 165–170, vẫn chậm rãi kể chuyện. */
export const LIFE_TEMPO = 1.1;

export const LIFE_BIBLE = `Kênh truyện audio "chuyện đời" — mỗi video là MỘT câu chuyện độc lập trọn vẹn khoảng 1 tiếng, kể liền mạch không chia chương, nhân vật mới mỗi truyện.
Khán giả: người Việt 35–60 tuổi, nghe khi nấu cơm, lái xe, trước giờ ngủ; thích chuyện gia đình, tình thân, hôn nhân, nhân quả, sự tử tế.
Đề tài chính: hy sinh của cha mẹ và sự vô tâm của con cái; mẹ chồng – nàng dâu; phản bội và tha thứ trong hôn nhân; anh em tranh chấp tài sản; người nghèo tử tế; bắt đầu lại ở tuổi trung niên; bí mật gia đình hé lộ sau nhiều năm.
Bối cảnh: Việt Nam hiện nay, thành phố và nông thôn; đời sống cụ thể (chợ, xe máy, nhà cấp bốn, tiền lương, tin nhắn Zalo).
Mọi truyện là HƯ CẤU, không trình bày như sự kiện có thật.
Tông giọng: lắng đọng, ấm, chân thật; có xót xa nhưng luôn để lại hy vọng hoặc sự thức tỉnh; không giảng đạo lý.`;

export const LIFE_PREMISE =
  "Những câu chuyện đời độc lập về tình cha mẹ, con cái, hôn nhân và những biến cố tuổi trung niên — mỗi video một truyện dài ~1 tiếng trọn vẹn, mở bằng biến cố, kết bằng cảm xúc.";

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

export const pilotOutline = (p: (typeof LIFE_PILOT)[number]) => `- ${p.plot}\n- Phát triển thành truyện dài ~1 tiếng trọn vẹn theo 5 hồi của kênh: biến cố mở đầu → tổn thương leo thang → chạm đáy và con đường mới → bước ngoặt → kết lắng đọng.\nCảm xúc chính: ${p.emotion}`;

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

/** Ít ảnh hơn tiên hiệp: chuyện đời ít hành động. Truyện 1 tiếng: 1 ảnh ~75 giây ≈ 48 ảnh (ảnh GPT có hạn lượt — đã vẽ thì cache). */
export const LIFE_IMAGE_SECONDS = 75;
export const LIFE_MAX_IMAGES = 50;

/** Từ khóa gốc nghiên cứu vidIQ. */
export const LIFE_SEEDS = ["chuyện đời", "truyện audio cảm động", "câu chuyện cuộc sống"];
