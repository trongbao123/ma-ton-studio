// Thể loại "Lịch sử" (kênh Sử Ký Kể Chuyện, khoá lich-su): mỗi chương là MỘT video tài liệu ~45 phút về một sự kiện/nhân vật,
// viết CHỈ từ hồ sơ tư liệu (Wikipedia vi + en) — không hư cấu. Mọi nhánh "nếu là lịch sử" trong luồng viết đọc từ file này.
import type { OpeningCheck } from "./editor";
import type { Chapter, Series } from "@/db/schema";

export const HISTORY_GENRE = "Lịch sử";
/** Bộ truyện thuộc thể loại lịch sử (so theo `series.genre`). */
export const isHistoryStory = (s: Pick<Series, "genre"> | null | undefined) => s?.genre === HISTORY_GENRE;

/** ~45 phút ở nhịp tài liệu (~165 từ/phút, không tăng tốc). Hiệu chỉnh lại khi đo giọng thật (Kế hoạch 3). */
export const HISTORY_TARGET_WORDS = 7500;
/** Mỗi lượt AI viết ~1 hồi — lượt dài hơn AI hay tóm tắt, bỏ mốc. */
export const HISTORY_PART_WORDS = 2500;

/** Một đề tài: `wiki` là tiêu đề bài Wikipedia tiếng Anh (bài tiếng Việt lấy qua langlink). */
export type HistoryTopic = { title: string; wiki: string; angle: string };

/**
 * 20 đề tài khởi đầu (21/11/2026): trộn Việt Nam cổ – trung đại và thế giới, ưu tiên đề tài nhiều tranh/ảnh/bản đồ trên Commons.
 * Thứ tự theo độ dày hồ sơ Wikipedia đã đo (vi+en): video đầu kênh dùng đề tài nhiều tư liệu; Bạch Đằng 938 chỉ ~12k ký tự nên để sau.
 * `angle` chỉ gợi khoảnh khắc mở đầu và câu hỏi trung tâm — chi tiết cụ thể phải lấy từ hồ sơ, không từ đây.
 */
export const HISTORY_PILOT: HistoryTopic[] = [
  { title: "Quang Trung Đại Phá Quân Thanh: Mùa Xuân Năm 1789", wiki: "Battle of Ngọc Hồi-Đống Đa", angle: "Mở ở những ngày Tết khi đại quân tiến ra Bắc. Câu hỏi: làm sao một cuộc hành quân thần tốc đổi cục diện chỉ trong vài ngày?" },
  { title: "Ngày Cuối Cùng Của Constantinople", wiki: "Fall of Constantinople", angle: "Mở ở những giờ cuối trước khi tường thành thất thủ. Câu hỏi: vì sao một đế chế nghìn năm sụp đổ trong một buổi sáng?" },
  { title: "Khởi Nghĩa Lam Sơn: Mười Năm Nếm Mật Nằm Gai", wiki: "Lam Sơn uprising", angle: "Mở ở thời khắc khó khăn nhất của nghĩa quân. Câu hỏi: làm sao từ vùng núi Lam Sơn, Lê Lợi đi tới ngày giành lại đất nước?" },
  { title: "Waterloo: Ngày Napoleon Mất Tất Cả", wiki: "Battle of Waterloo", angle: "Mở ở buổi chiều quyết định trên chiến trường Waterloo. Câu hỏi: điều gì đã kết thúc sự nghiệp của Napoleon chỉ trong một ngày?" },
  { title: "Bạch Đằng Lần Nữa: Trận Đánh Năm 1288", wiki: "Battle of Bạch Đằng (1288)", angle: "Mở ở lúc đoàn thuyền đối phương rút qua cửa sông. Câu hỏi: người Đại Việt đã lặp lại bài học cũ ra sao trước đội quân mạnh nhất thời ấy?" },
  { title: "Titanic: Hai Tiếng Bốn Mươi Phút Cuối Cùng", wiki: "Sinking of the Titanic", angle: "Mở ở lúc con tàu va phải tảng băng. Câu hỏi: vì sao con tàu được gọi là không thể chìm lại chìm, và vì sao nhiều người không được cứu?" },
  { title: "Hai Bà Trưng: Cuộc Khởi Nghĩa Làm Rung Chuyển Phương Nam", wiki: "Trưng sisters", angle: "Mở ở lúc cuộc khởi nghĩa bùng lên. Câu hỏi: hai người phụ nữ đã đứng lên thế nào, và sử sách ghi lại những gì về họ?" },
  { title: "Tsushima: Hạm Đội Đi Nửa Vòng Trái Đất Để Chìm", wiki: "Battle of Tsushima", angle: "Mở ở lúc hai hạm đội nhìn thấy nhau ở eo biển Tsushima. Câu hỏi: vì sao chuyến hải trình dài nhất lại kết thúc trong một trận?" },
  { title: "Phòng Tuyến Sông Như Nguyệt Của Lý Thường Kiệt", wiki: "Battle of Như Nguyệt River (1077)", angle: "Mở ở phòng tuyến bên sông trước đợt tấn công lớn. Câu hỏi: nhà Lý đã giữ vững phòng tuyến ra sao, và sử sách chép gì về bài thơ gắn với trận này?" },
  { title: "Thermopylae: Con Đèo Hẹp Chặn Một Đế Chế", wiki: "Battle of Thermopylae", angle: "Mở ở ngày cuối cùng tại đèo Thermopylae. Câu hỏi: vì sao một đội quân nhỏ được nhớ mãi dù thua trận?" },
  { title: "Trận Bạch Đằng Năm 938: Những Cọc Gỗ Dưới Lòng Sông", wiki: "Battle of Bạch Đằng (938)", angle: "Mở ở khoảnh khắc nước triều rút trên sông Bạch Đằng. Câu hỏi: vì sao trận này khép lại hơn một nghìn năm Bắc thuộc?" },
  { title: "Xích Bích: Trận Hỏa Công Chia Ba Thiên Hạ", wiki: "Battle of Red Cliffs", angle: "Mở ở đêm lửa bốc trên sông Trường Giang. Câu hỏi: sử thật khác Tam Quốc diễn nghĩa ở những điểm nào?" },
  { title: "Cảng Lữ Thuận: Cuộc Vây Hãm Làm Thay Đổi Châu Á", wiki: "Siege of Port Arthur", angle: "Mở ở một đợt tấn công lên các pháo đài quanh cảng. Câu hỏi: vì sao cảng biển không đóng băng này đáng để hai đế quốc đổ máu?" },
  { title: "Hannibal Vượt Dãy Alps", wiki: "Hannibal's crossing of the Alps", angle: "Mở ở đoàn quân và những con voi giữa đèo núi tuyết. Câu hỏi: vì sao Hannibal chọn con đường tưởng như không thể đi?" },
  { title: "Ngày 15 Tháng 3: Cái Chết Của Julius Caesar", wiki: "Assassination of Julius Caesar", angle: "Mở ở buổi sáng Caesar tới cuộc họp của Viện Nguyên lão. Câu hỏi: vì sao những người thân cận nhất lại ra tay?" },
  { title: "Napoleon Ở Nước Nga: Đại Quân Biến Mất Trong Tuyết", wiki: "French invasion of Russia", angle: "Mở ở cảnh Moskva bốc cháy. Câu hỏi: đội quân lớn nhất châu Âu khi ấy đã tan rã thế nào?" },
  { title: "Hastings 1066: Ngày Nước Anh Đổi Chủ", wiki: "Battle of Hastings", angle: "Mở ở ngọn đồi nơi hai đạo quân đối mặt. Câu hỏi: một trận đánh trong một ngày đã đổi vận mệnh nước Anh ra sao?" },
  { title: "Tần Thủy Hoàng Thống Nhất Sáu Nước", wiki: "Qin's wars of unification", angle: "Mở ở lúc nước cuối cùng đầu hàng. Câu hỏi: nước Tần đã nuốt từng nước một như thế nào?" },
  { title: "Gaugamela: Alexander Đối Đầu Đế Chế Ba Tư", wiki: "Battle of Gaugamela", angle: "Mở ở buổi sáng hai đạo quân dàn trận trên đồng bằng. Câu hỏi: vì sao đạo quân ít hơn lại thắng?" },
  { title: "Thành Cát Tư Hãn: Từ Đứa Trẻ Bị Bỏ Rơi Đến Đế Chế Lớn Nhất", wiki: "Genghis Khan", angle: "Mở ở tuổi thơ khốn khó của Temüjin. Câu hỏi: làm sao một người như thế dựng nên đế chế liền một dải lớn nhất lịch sử?" },
];

const WIKI_LINE = "Wikipedia: ";
/** Dàn ý lưu vào `chapters.outline`: góc kể + dòng `Wikipedia: <tiêu đề tiếng Anh>` để bước gom hồ sơ biết bài nào. */
export const topicOutline = (t: HistoryTopic) => `${t.angle}\n${WIKI_LINE}${t.wiki}`;
/** Tiêu đề bài Wikipedia tiếng Anh ghi trong dàn ý; không có thì null. */
export function wikiTitleOf(outline: string): string | null {
  // AI hay ghi dàn ý dạng gạch đầu dòng ("- Wikipedia: X") — bỏ gạch/khoảng trắng đầu dòng trước khi so.
  const line = outline
    .split("\n")
    .map((l) => l.replace(/^[\s\-•*]+/, "").trim())
    .find((l) => l.startsWith(WIKI_LINE));
  return line ? line.slice(WIKI_LINE.length).trim() || null : null;
}

/**
 * Chủ kênh 21/11/2026: "cái gì nhạy cảm quá thì né". Từ khoá tiếng Việt so trên chuỗi CÒN DẤU — bỏ dấu thì "đại loạn" thành
 * "dai loan" (Đài Loan), "biến động" thành "bien dong" (Biển Đông). Từ khoá ASCII so theo ranh giới từ.
 */
const SENSITIVE_VI_KEYWORDS = [
  "hoàng sa", "trường sa", "biển đông", "biên giới 1979", "chiến tranh việt nam", "kháng chiến chống mỹ",
  "việt nam cộng hòa", "việt nam cộng hoà", "đài loan", "tây tạng", "tân cương",
];
const SENSITIVE_ASCII = /\b(israel|palestine|gaza|ukraine|taiwan|tibet|xinjiang|spratly|paracel)\b/i;
/** Mốc bắt đầu vùng nhạy cảm: chiến tranh/chính trị hiện đại. */
const SENSITIVE_FROM_YEAR = 1945;
/**
 * Số 4 chữ số được coi là NĂM khi đứng sau "năm/year" hoặc không có chữ theo sau ("Điện Biên Phủ 1954", "(1968)");
 * "2000 kỵ binh" là số lượng, không phải năm.
 */
const YEAR_PATTERN = /(?:\b(?:năm|year)\s+(\d{4})\b)|(?:\b(\d{4})\b(?!\s*\p{L}))/giu;

/** Đề tài chạm vùng nhạy cảm chính trị (năm ≥ 1945 hoặc từ khoá cấm) — bị loại trước khi lưu. */
export function isSensitiveTopic(text: string): boolean {
  const lower = text.normalize("NFC").toLowerCase();
  const thisYear = new Date().getFullYear();
  const modernYear = [...lower.matchAll(YEAR_PATTERN)].some((m) => {
    const year = Number(m[1] ?? m[2]);
    return year >= SENSITIVE_FROM_YEAR && year <= thisYear;
  });
  return modernYear || SENSITIVE_VI_KEYWORDS.some((k) => lower.includes(k)) || SENSITIVE_ASCII.test(lower);
}

/** Kịch bản đã viết tới lượt kết (đủ ~85% độ dài): lượt sau chỉ cần soát + chốt, không viết tiếp đè sau đoạn kết. */
export const historyScriptComplete = (words: number, target = HISTORY_TARGET_WORDS) => words >= target * 0.85;

/** Luật không hư cấu — dùng chung cho người viết và người soát. */
const NO_FICTION_RULES = [
  "KHÔNG HƯ CẤU: chỉ dùng tên người, địa danh, năm tháng, con số, diễn biến CÓ TRONG HỒ SƠ. Hồ sơ không có thì không nói.",
  // Chủ kênh 21/11/2026: lời kể "Theo bách khoa Wikipedia tiếng Anh…" ở gần mọi câu — cấm hẳn.
  "KHÔNG nêu tên nguồn tra cứu trong lời kể: không nói Wikipedia, bách khoa, hồ sơ, tư liệu, tài liệu tham khảo, tên trang web hay tạp chí. Người dẫn chuyện kể thẳng sự kiện như phim tài liệu ('Đêm 30 Tết, quân Tây Sơn vượt sông…').",
  "Chỉ được nêu tên SỬ LIỆU GỐC hoặc SỬ GIA (Đại Việt sử ký toàn thư, Hoàng Lê nhất thống chí, Khâm định Việt sử thông giám cương mục, Herodotus, Plutarch…) và chỉ khi: trích nguyên văn câu nói, hoặc các nguồn vênh nhau ở điểm QUAN TRỌNG.",
  "Không bịa lời thoại. Chỉ trích câu nói khi câu đó có nguyên văn trong hồ sơ ('Đại Việt sử ký toàn thư chép lời vua rằng…').",
  "Nguồn vênh nhau: chỉ nói ra khi lệch ở điểm QUAN TRỌNG (quân số, thương vong, kết cục, ai làm gì) — 'sử cũ chép…, nhưng cũng có ghi chép cho rằng…'. Lệch vặt (ngày lệch 1–2 hôm, cách phân công, tên phụ) thì kể theo bản các nguồn trùng nhau nhiều hơn hoặc bỏ chi tiết đó, KHÔNG kể chuyện tranh cãi tài liệu. Truyền thuyết thì nói là truyền thuyết.",
  "Thứ bậc tin cậy khi phải chọn (đầu mục hồ sơ ghi loại): sử liệu gốc (wikisource) và bách khoa (wikipedia, Britannica) hơn báo (web).",
  "Không suy diễn cảm xúc, suy nghĩ của nhân vật thành sự thật; muốn gợi không khí thì tả bối cảnh chung (sông nước, mùa, địa hình) không gắn số liệu.",
  "Đề tài cổ – trung đại: KHÔNG liên hệ sang chính trị, biên giới, tranh chấp hiện đại.",
];

export const HISTORY_STYLE = "Người dẫn chuyện phim tài liệu, ngôi thứ ba, giọng trầm và chắc; câu ngắn, rõ cho tai nghe; kịch tính đến từ diễn biến thật";
export const HISTORY_PREMISE = "Lịch sử Việt Nam và thế giới, kể như một bộ phim — đúng sử liệu, không hư cấu. Mỗi video trọn một sự kiện hoặc một nhân vật.";
export const HISTORY_BIBLE = `Kênh "Sử Ký Kể Chuyện": phim tài liệu kể chuyện lịch sử ~45 phút, mỗi video trọn một sự kiện/nhân vật, Việt Nam và thế giới.
Người xem: người Việt yêu lịch sử, muốn hiểu đúng và được kể cuốn như xem phim.
Uy tín là tất cả: mọi chi tiết có nguồn; sai sử là mất kênh. Né đề tài chính trị nhạy cảm hiện đại.`;

/** Đoạn mẫu chủ kênh duyệt 21/11/2026 (viết lại từ một câu "đọc như Wikipedia" của bản cũ) — chỉ để học giọng. */
const HISTORY_EXEMPLAR = `Ông chưa bước vào, người ta đã nghe thấy tiếng. Giọng nói sang sảng, vang như chuông. Đôi mắt sáng quắc. Tướng sĩ dưới trướng vừa nể, vừa sợ.
Và điều lạ nhất: người tả ông như thế lại chính là kẻ thù. Sử quan nhà Nguyễn, những người viết sử cho đối thủ không đội trời chung của Tây Sơn, cũng phải chép rằng: đây là một kẻ lắm mưu nhiều kế, cầm quân giỏi, ai gặp cũng phải nể sợ.`;

/**
 * Luật 300 từ đầu kịch bản lịch sử — biên tập viên AI (editor.ts) chấm sau lượt viết đầu. Viết lại phần mở vẫn dùng prompt có
 * hồ sơ tư liệu, và soát sự thật lượt cuối vẫn chạy sau đó → không lọt chi tiết bịa (28/11/2026, giữ chân như chuyện đời).
 */
export const HISTORY_OPENING_RULES = [
  "Câu đầu dưới 20 từ, đặt người nghe vào giữa một khoảnh khắc căng nhất hoặc một sự thật gây sốc của sự kiện (thời gian, nơi chốn, việc đang xảy ra). KHÔNG mở bằng năm sinh, tiểu sử, định nghĩa, 'vào năm…, tại…' kiểu sách giáo khoa, hay câu chào.",
  "Trong 150 từ đầu có một đối lập hoặc con số gây sốc lấy từ hồ sơ (ít đánh nhiều, kẻ thù phải thừa nhận, khoảng cách/thời gian không tưởng).",
  "Trong 300 từ đầu có một câu hỏi lớn nói thành lời mà người nghe muốn biết đáp án (làm sao, vì sao, rồi ra sao) — chưa trả lời ngay.",
  "Câu ngắn, thì hiện tại, cận cảnh; không quá 2 câu bối cảnh/giải thích liền nhau; không bình luận sử học, không 'theo sử sách ghi lại'.",
  "Không có lời thoại hay suy nghĩ bịa cho nhân vật cụ thể; mọi chi tiết phải có trong hồ sơ tư liệu.",
];

/** Biên tập viên AI cho lịch sử: chấm 300 từ đầu theo HISTORY_OPENING_RULES. */
export const HISTORY_OPENING_CHECK: OpeningCheck = {
  rules: HISTORY_OPENING_RULES,
  editor: "Bạn là biên tập viên khó tính của kênh phim tài liệu lịch sử Việt Nam trên YouTube. Người xem bấm vào rồi thoát ngay nếu 20 giây đầu đọc như sách giáo khoa. Bạn chấm xem đoạn mở đầu có kéo họ vào như phim không, và có giữ đúng sự thật không.",
};

/** Ba hồi của kịch bản ~45 phút (mỗi hồi ≈ một lượt viết). */
export const HISTORY_ACTS = [
  "HỒI 1 — mở in medias res: thả người nghe vào khoảnh khắc căng nhất của sự kiện (chi tiết có trong hồ sơ), 4–6 câu, dừng ở một câu hỏi lớn; rồi lùi lại: bối cảnh thời đại, các phe, con người chính, vì sao mọi thứ dẫn tới đây.",
  "HỒI 2 — diễn biến theo trình tự thời gian: khoảng 1.200 từ lại có một mốc mới làm tình thế đổi; khi nhảy thời gian nói rõ năm/tháng ('Tháng Ba năm 1288…'); giải thích chiến thuật, địa hình, lựa chọn của từng bên bằng lời dễ hiểu.",
  "HỒI 3 — cao trào và kết cục: quay lại khoảnh khắc đã mở đầu, kể trọn; số phận các nhân vật chính theo hồ sơ; hệ quả lịch sử dài hạn; câu kết gợi suy ngẫm nhưng KHÔNG giảng đạo lý.",
];

const HISTORY_WRITER_SYSTEM = `Bạn là người viết lời dẫn phim tài liệu lịch sử tiếng Việt cho YouTube (kênh "Sử Ký Kể Chuyện"). Mục tiêu: người xem hiểu ĐÚNG lịch sử và xem hết vì cuốn như phim.
LUẬT SỰ THẬT (bắt buộc, không ngoại lệ — kênh này không hư cấu):
- ${NO_FICTION_RULES.join("\n- ")}
KỂ NHƯ PHIM, NGƯỜI NGHE NHẬP VAI (chủ kênh 21/11/2026: "đọc y chang Wikipedia, người nghe muốn như nhập vai trong đó"):
- Đặt MÁY QUAY giữa cảnh: câu ngắn, thì hiện tại, cận cảnh — thời gian, nơi chốn, việc đang xảy ra ("Đêm 30 Tết. Đoàn quân lặng lẽ xuống thuyền."). Chi tiết bối cảnh chỉ lấy từ hồ sơ (mùa, giờ, địa hình, sông nước, đường hành quân); tả không khí chung thì được, không gắn số liệu bịa.
- Đặt người nghe vào vai bằng câu "Hãy hình dung bạn là…" (một người lính, một người dân kinh thành…) — CHỈ cho những gian khổ/tình thế CÓ GHI trong hồ sơ (đi bao xa, bao lâu, trời rét, bị vây). Mỗi kịch bản 2–4 lần, đặt ở các bước ngoặt.
- Biến sự thật thành kịch tính: đối lập (ít đánh nhiều, kẻ thù cũng phải thừa nhận), con số gây sốc, chi tiết lạ, cú lật; cuối mỗi đoạn một câu treo kéo người nghe sang đoạn sau. Đoạn giao chiến nhịp nhanh, câu rất ngắn.
- KHÔNG bình luận sử học trong lời kể ("đây là lời của sử quan…", "các nguồn ghi khác nhau…", "sử gia nhận định…") — trừ khi nguồn vênh ở điểm thật sự quan trọng. Sự thật về nguồn có kịch tính thì kể thành cú lật (vd chính kẻ thù chép lại lời khen).
- KHÔNG bịa lời thoại, KHÔNG bịa suy nghĩ của một nhân vật cụ thể ("ông nghĩ thầm…").
CÁCH VIẾT CHO TAI NGHE:
- Ngôi thứ ba, người dẫn chuyện. Câu ngắn, mỗi câu một ý. Năm và số viết bằng chữ số để giọng đọc đọc đúng (năm 938, 20.000 quân).
- Tên nước ngoài: dùng tên Việt quen dùng nếu có (Nã Phá Luân → dùng "Napoleon", Thành Cát Tư Hãn), lần đầu có thể kèm tên gốc.
- Kịch tính bằng cấu trúc: câu hỏi treo, mốc thời gian, đối lập lực lượng — không bằng tính từ sáo ('hào hùng', 'oai hùng' tối đa 1 lần).
- Không chào hỏi, không giới thiệu kênh, không markdown, không tiêu đề phụ, không ghi "Hồi 1".
- Đúng MỘT lần, ở cuối HỒI 1 ngay sau câu treo, người dẫn nói 1 câu ngắn tự nhiên mời ở lại và đăng ký kênh, gắn với điều sắp kể (vd "Điều gì đã xảy ra ở bờ sông ấy? Hãy ở lại cùng Sử Ký Kể Chuyện, và đăng ký kênh để không bỏ lỡ những trang sử như thế này."). Không lặp lời mời ở chỗ khác, không xin like, không nói "bấm chuông".
GIỌNG MẪU (chủ kênh duyệt — học nhịp và cách biến sự thật thành cảnh; KHÔNG chép nội dung):
${HISTORY_EXEMPLAR}`;

/** System prompt người viết kịch bản lịch sử (giọng của bộ ghép thêm ở prompt). */
export function historyWriterSystem() {
  return HISTORY_WRITER_SYSTEM;
}

/** Prompt lượt đầu: đề tài + hồ sơ tư liệu; lượt đầu chỉ viết HỒI 1. */
export function historyChapterPrompt(s: Series, chapter: Chapter, dossierText: string) {
  return {
    system: `${HISTORY_WRITER_SYSTEM}\nGiọng của kênh: ${s.style || HISTORY_STYLE}.`,
    prompt: `Đề tài: "${chapter.title}"
Gợi ý góc kể: ${chapter.outline}

HỒ SƠ TƯ LIỆU (nguồn DUY NHẤT được dùng — không hư cấu, không thêm chi tiết ngoài hồ sơ):
<ho_so>
${dossierText}
</ho_so>

Cả kịch bản khoảng ${s.targetWords} từ (≈ 45 phút đọc), một mạch liền, viết theo nhiều lượt, mỗi lượt một hồi:
${HISTORY_ACTS.map((a) => `- ${a}`).join("\n")}

Lượt NÀY chỉ viết HỒI 1, khoảng ${HISTORY_PART_WORDS} từ, dừng ở một câu treo dẫn sang diễn biến chính — CHƯA kết. Chỉ trả về lời dẫn, không lời bình, không tiêu đề.
Trước khi viết, tự lên (trong đầu, KHÔNG in ra) dòng thời gian các mốc trong hồ sơ để các lượt sau đi tiếp không lệch, không lặp.`,
  };
}

/** Lượt này là lượt CUỐI khi phần còn thiếu vừa một lượt dài. */
export const historyIsFinalPart = (written: number, target = HISTORY_TARGET_WORDS) => target - written <= HISTORY_PART_WORDS * 1.4;

/** Nhiệm vụ của lượt viết tiếp (ghép sau phần đã viết). */
export function historyContinueTask(written: number, target = HISTORY_TARGET_WORDS) {
  const common = "Không lặp lại đoạn đã viết, không tóm tắt lại, không ghi tên hồi; giữ đúng mọi tên, năm, con số đã dùng; vẫn CHỈ dùng chi tiết trong hồ sơ.";
  if (historyIsFinalPart(written, target)) {
    const remaining = Math.max(target - written, HISTORY_PART_WORDS);
    return `Đã viết ${written}/${target} từ. Viết TIẾP từ đúng chỗ dừng, thêm khoảng ${remaining} từ — đây là lượt CUỐI: đi nốt diễn biến còn lại rồi ${HISTORY_ACTS[HISTORY_ACTS.length - 1]} ${common}`;
  }
  return `Đã viết ${written}/${target} từ. Viết TIẾP từ đúng chỗ dừng thêm khoảng ${HISTORY_PART_WORDS} từ theo ${HISTORY_ACTS[1]} Dừng ở một câu treo — CHƯA kết. ${common}`;
}

/** Hết đề tài: AI đề xuất đề tài mới (mỗi đề tài kèm dòng Wikipedia tiếng Anh); đề tài nhạy cảm bị lọc lại ở service. */
export function historyOutlinePrompt(s: Series, previous: Pick<Chapter, "number" | "title">[], count: number) {
  const startAt = (previous.at(-1)?.number ?? 0) + 1;
  return {
    system: HISTORY_WRITER_SYSTEM,
    prompt: `Kênh: ${s.title}
${s.bible.slice(0, 1500)}

Đề tài đã có (KHÔNG trùng):
${previous.map((c) => `- ${c.title}`).join("\n") || "(chưa có)"}

Đề xuất ${count} đề tài MỚI (số ${startAt}–${startAt + count - 1}), xen kẽ Việt Nam (cổ – trung đại, trước 1858) và thế giới; mỗi đề tài một sự kiện hoặc một nhân vật có bài Wikipedia tiếng Anh dài, nhiều tranh/ảnh/bản đồ tư liệu.
CẤM: mọi đề tài từ năm 1945 trở đi; chiến tranh/chính trị Việt Nam hiện đại; quan hệ Việt – Trung hiện đại; Hoàng Sa, Trường Sa, Biển Đông; biên giới 1979; xung đột hiện đại còn tranh cãi (Trung Đông, Nga – Ukraine, Đài Loan, Tây Tạng, Tân Cương).
- title: tiêu đề YouTube tiếng Việt, VIẾT HOA mỗi từ, gây tò mò nhưng đúng sự thật, được nêu tên sự kiện/nhân vật, 40–80 ký tự.
- outline: dòng 1 gợi khoảnh khắc mở đầu + câu hỏi trung tâm (không nêu chi tiết số liệu); dòng 2 đúng dạng "${WIKI_LINE}<tiêu đề bài Wikipedia tiếng Anh chính xác>".`,
  };
}

/** Đề tài kế tiếp để viết: chương `outline` đầu tiên không "chờ sửa" (chưa có lỗi sự thật tồn đọng). */
export function pickChapterToWrite<T extends { status: string; factIssues: unknown }>(list: T[]): T | undefined {
  return list.find((c) => c.status === "outline" && c.factIssues == null);
}

/** Trạng thái đề tài trên trang quản lý kênh lịch sử. */
export type HistoryTopicStatus = "chua-viet" | "dang-viet" | "cho-sua" | "co-kich-ban" | "co-video";
export const HISTORY_STATUS_LABEL: Record<HistoryTopicStatus, string> = {
  "chua-viet": "Chưa viết",
  "dang-viet": "Đang viết",
  "cho-sua": "Chờ sửa",
  "co-kich-ban": "Có kịch bản",
  "co-video": "Có video",
};

/** Trạng thái hiển thị của một đề tài (ưu tiên: có video > chờ sửa > có kịch bản > đang viết > chưa viết). */
export function historyTopicStatus(c: { status: string; content: string; factIssues: unknown }, hasVideo: boolean): HistoryTopicStatus {
  if (hasVideo) return "co-video";
  if (c.factIssues != null) return "cho-sua";
  if (c.status === "draft" || c.status === "approved") return "co-kich-ban";
  return c.content.trim() ? "dang-viet" : "chua-viet";
}

/** Kiểm đề tài chủ kênh thêm tay: trả thông báo lỗi, hợp lệ thì null. */
export function validateHistoryTopic(title: string, wiki: string): string | null {
  if (!title.trim()) return "Cần tiêu đề đề tài.";
  if (!wiki.trim()) return "Cần tên bài Wikipedia tiếng Anh (để gom tư liệu).";
  if (isSensitiveTopic(`${title}\n${wiki}`)) return "Đề tài chạm vùng nhạy cảm chính trị — kênh đã chọn né.";
  return null;
}

/** Kịch bản lịch sử còn lỗi sự thật thì không được duyệt (duyệt = xếp hàng render). Trả lý do, được duyệt thì null. */
export function approvalBlockedReason(c: { factIssues: unknown }): string | null {
  return c.factIssues != null ? "Kịch bản còn lỗi sự thật — sửa rồi bấm “Soát lại” trước khi duyệt." : null;
}

/**
 * Giọng người dẫn (ivoi "History US", giọng ivoi làm riêng cho nội dung lịch sử) — chủ kênh chọn 22/11/2026 sau khi nghe 23 giọng nam:
 * 162 từ/phút, đúng nhịp phim tài liệu (150–190).
 */
export const HISTORY_IVOI_VOICE = "en_male_history_1";
/** Không tăng tốc giọng: kênh truyện nhân 1,2 cho nhịp nhanh, phim tài liệu cần chậm và chắc. */
export const HISTORY_TEMPO = 1;
