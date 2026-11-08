// Viết lại story bible + dàn ý 10 chương cho series #4 (chỉ xoá chương chưa viết).
import { sql as q } from "drizzle-orm";
import { db } from "@/db";
import { draftBible, planChapters } from "@/lib/story/service";

// Đi qua db() để có fetch tự thử lại khi mạng chập.
const sql = async (s: TemplateStringsArray, ...v: unknown[]) => (await db().execute(q(s, ...v))).rows as Record<string, unknown>[];
const idea = `Tu tiên dài kỳ NGUYÊN TÁC của kênh: viết theo đúng lối của Đấu La Đại Lục 3, Quang Âm Chi Ngoại, Thôn Phệ Tinh Không rồi cải biên cho đỉnh hơn — cảm xúc, cao trào, ly kỳ, bánh cuốn. Tên người, tông môn, địa danh, chiêu thức tự đặt mới; lấy cơ chế, mô-típ, kiểu nhân vật, cảm giác — không chép nguyên tình tiết.

THẾ GIỚI:
- Thi thể thần linh khổng lồ rơi xuống, sương độc dị hóa, cấm địa nhiều màu, nhặt tàn hồn thần linh để tu luyện (Quang Âm Chi Ngoại).
- Yêu thú tràn vào, nhân loại co cụm trong thành có tường lũy; ngoài thành là hoang dã, đội săn yêu thú, sức mạnh đo bằng con số, có bảng xếp hạng (Thôn Phệ Tinh Không).
- Học viện/tông môn đào tạo thiên tài, đội 7 người thi đấu, tự rèn pháp giáp có cấp bậc, huyết mạch phong ấn mở từng tầng (Đấu La 3).
- Về sau mở ra tinh không vạn tộc, truyền thừa cường giả viễn cổ.

NHÂN VẬT CHÍNH tên LÂM UYÊN (bắt buộc đúng tên này), dung hợp tính cách 3 nhân vật chính: lạnh lùng, cẩn thận, tàn nhẫn với kẻ thù, giỏi độc, có ơn trả gấp bội (kiểu Hứa Thanh); khổ luyện, kiên định, gia đình là tất cả (kiểu La Phong); bên trong ấm áp, trọng nghĩa, ăn khỏe do huyết mạch, thiên phú rèn đúc (kiểu Đường Vũ Lân). Bàn tay vàng: thần ấn thôn phệ + huyết mạch cổ phong ấn + cái bóng bí ẩn trong cơ thể + niệm lực phi đao.

NHÂN VẬT PHỤ (đặt tên mới, mỗi người có cá tính, mục tiêu riêng, arc riêng, câu cửa miệng; dựng theo các kiểu nhân vật phụ được yêu thích của 3 bộ):
- Em gái nhỏ yếu ớt có thể chất đặc biệt — bị bắt đi, mục tiêu dài hạn (kiểu người em La Phong che chở).
- Ân nhân đầu tiên: đội trưởng đội nhặt rác/săn thú già dặn, cứu hắn khỏi thành hoang, chết để bảo vệ hắn (kiểu đội trưởng Lôi trong Quang Âm).
- Sư phụ mưu sâu khó lường, ngoài lạnh trong thương đồ đệ, có bí mật lớn (kiểu Thất Gia).
- Huynh đệ chí cốt: thiên tài kiếm đạo đẹp trai tự luyến, lầy lội, mồm mép, chết cũng không bỏ bạn (kiểu Tạ Giải).
- Gã điên khó đoán nhưng cực mạnh, vừa hài vừa đáng sợ, thành đồng minh (kiểu đội trưởng "điên" của Quang Âm).
- Cô gái bí ẩn thân phận cực lớn, thực ra là người của phe đối địch/thần tộc — tình yêu trắc trở (kiểu Cổ Nguyệt).
- Cô bé nhỏ có năng lực tiên tri/tinh thần, đáng yêu, là tim của đội; cô gái mạnh mẽ có hai huyết mạch; gã to con chậm mà chắc làm khiên.
- Người thầy nghiêm khắc lạnh như băng của học viện, về sau hy sinh vì học trò (kiểu Vũ Trường Không).
- Đối thủ cùng thế hệ kiêu ngạo, về sau thành bạn hoặc chết dưới tay hắn; kẻ phản bội trong đội.
- Phản diện lớn phía sau: tàn dư thần linh và tông môn cấu kết; một đại năng viễn cổ để lại truyền thừa (kiểu truyền thừa trong Thôn Phệ).
- Thú cưng/phân thân: con yêu thú non hắn cứu, thôn phệ lớn dần (kiểu Kim Giác Cự Thú).

CẢM XÚC & CAO TRÀO bắt buộc: chương 1 đêm mưa máu mẹ hy sinh để Lâm Uyên cõng em gái chạy thoát; ân nhân chết; đồng đội phản bội; em gái bị bắt; người thầy hy sinh; tình yêu với cô gái phe địch; bí mật thân thế liên quan thần linh đã chết; nhiều lần bị dồn vào tuyệt cảnh rồi lật kèo trước toàn thiên hạ.`;

const d = await draftBible(idea, "tiên hiệp");
await sql`update series set title=${d.title}, premise=${d.premise}, bible=${d.bible}, style=${d.style}, autopilot=true, auto_approve=true, chapters_per_day=1 where id=4`;
await sql`delete from chapters where series_id=4 and content = ''`;
console.log("bible", d.title);
await planChapters(4, 10);
for (const r of await sql`select number, title from chapters where series_id=4 order by number`) console.log(r.number, r.title);
console.log("PREMISE", d.premise);
console.log("BIBLE", d.bible);
