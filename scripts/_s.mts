import { draftBible, planChapters } from "@/lib/story/service";
import { db } from "@/db";
import { series } from "@/db/schema";
try {
const idea = `Đại lục nơi mỗi người 6 tuổi thức tỉnh "Linh Hồn Khí" (vũ khí hoặc thú hồn), săn hồn thú để gắn "Hồn Văn" theo màu (trắng 10 năm, vàng 100 năm, tím 1000 năm, đen vạn năm, đỏ 10 vạn năm), cấp 1–100. Nhân vật chính là thằng nhóc nghèo lém lỉnh ở thôn mỏ, thức tỉnh linh hồn khí bị chê là phế vật (một cái nồi sắt cũ), nhưng thật ra là thần khí thôn phệ có thể nuốt hồn văn của kẻ địch, và hắn còn giấu linh hồn khí thứ hai. Hắn vào học viện quái vật nhận toàn học viên cá biệt, lập nhóm 6 đồng đội lầy lội, đánh giải đấu toàn đại lục, dần lộ thân thế liên quan tới thần giới. Giọng kể hài hước, vả mặt liên tục, có tình đồng đội và tình cảm.`;
const d = await draftBible(idea, "huyền huyễn");
console.log("bible", d.title);
const [row] = await db().insert(series).values({ ...d, genre: "huyền huyễn", targetWords: 3000, autopilot: true, autoApprove: true, chaptersPerDay: 2 }).returning();
console.log("series", row.id);
await planChapters(row.id, 10);
console.log("DONE planned");
} catch (e) { console.log("ERR", String(e).slice(0, 1500), JSON.stringify((e as any)?.cause ?? "").slice(0, 800)); }
