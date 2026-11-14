// Mô-típ cho bộ truyện mới (lệnh `newseries:<key>` trong pipeline/new-series.ts). Ý tưởng tự sáng tác — chỉ dùng mô-típ chung
// của thể loại (trùng sinh, xuyên không, hệ thống), không bám cốt truyện/nhân vật của bộ đã xuất bản.
import type { Series } from "@/db/schema";

export type Trope = { key: string; genre: string; idea: string };

export const TROPES: Trope[] = [
  {
    key: "trungsinh",
    genre: "tu tiên · trùng sinh",
    idea:
      "Một kiếm tu bị chính sư tôn và đạo lữ phản bội, chết trong đại kiếp ba trăm năm sau. Hắn mở mắt ra thì đã trùng sinh về năm mười lăm tuổi, " +
      "đúng sáng ngày khảo hạch nhập môn đầu tiên, mang theo toàn bộ ký ức tương lai: bí cảnh nào sắp mở, bảo vật giấu ở đâu, kẻ nào sẽ phản bội. " +
      "Hắn dùng ký ức để đi trước thiên hạ một bước và báo thù từng kẻ, nhưng mỗi lần đổi lịch sử thì tương lai lệch dần khỏi trí nhớ, " +
      "và hắn dần phát hiện cái chết kiếp trước không phải ngẫu nhiên — có kẻ cũng đang nhớ tương lai.",
  },
  {
    key: "xuyenkhong",
    genre: "tu tiên · xuyên không",
    idea:
      "Một kỹ sư hiện đại chết trong tai nạn phòng thí nghiệm, xuyên không vào thân xác một phế vật vừa bị gia tộc tu tiên đuổi ra vùng biên hoang. " +
      "Không linh căn tốt, không ai chống lưng, hắn chỉ có đầu óc của người thế kỷ 21: phân tích công pháp như phương trình, luyện đan như làm thí nghiệm, " +
      "dựng trận pháp như thiết kế mạch điện — những thứ tu sĩ nơi này chưa từng nghĩ tới. Hắn phải giấu thân phận người ngoài giới, " +
      "vì thế giới này từng săn lùng và thiêu sống những 'kẻ đoạt xá' như hắn.",
  },
  {
    key: "hethong",
    genre: "tu tiên · hệ thống",
    idea:
      "Một thiếu niên tạp dịch thấp kém nhất tông môn bị đánh gần chết thì thức tỉnh Hệ Thống Ký Danh: mỗi ngày ký danh tại một nơi sẽ nhận phần thưởng, " +
      "nơi càng nguy hiểm, càng cấm kỵ thì phần thưởng càng khủng (công pháp, tu vi, thần thông, cả thọ nguyên). Lời hệ thống là câu ngắn theo khuôn cố định, " +
      "có con số rõ ràng. Hắn liều mạng ký danh ở cấm địa, mộ tổ, lôi trì, cả phòng ngủ của tông chủ, mạnh lên trong im lặng, " +
      "trong khi cả tông môn vẫn tưởng hắn là phế vật — và hệ thống dường như đang dẫn hắn tới một bí mật bị chôn vùi.",
  },
  {
    // Công thức "tưởng… nào ngờ…": bị coi thường → lật kèo trước đám đông (học từ video review top, chỉ lấy mô-típ).
    key: "giaunghe",
    genre: "tu tiên · giả heo ăn hổ",
    idea:
      "Một gã mù gầy gò mở quán trà nhỏ ở trấn biên ải, bị dân trấn khinh là phế nhân, bị lưu manh bắt nạt mà chỉ cười. Không ai biết đôi mắt hắn " +
      "tự tay móc bỏ để luyện một môn đao nghe được hơi thở của vạn vật, và hắn từng là kẻ một mình chém sập cả một thánh địa. " +
      "Mỗi lần yêu ma, cường giả, đại tông môn kéo tới ức hiếp trấn nhỏ, hắn chỉ rút đao một lần — và cả trấn chết lặng. " +
      "Kẻ thù cũ đang lần theo dấu vết đao ý ấy, còn hắn chỉ muốn giữ yên ngôi trấn và cô bé mồ côi mà hắn nhận nuôi.",
  },
];

export function tropeOf(key: string): Trope {
  const t = TROPES.find((x) => x.key === key.trim());
  if (!t) throw new Error(`Không có mô-típ "${key}" — chọn: ${TROPES.map((x) => x.key).join(", ")}`);
  return t;
}

/** Cấu hình vận hành lấy từ bộ đang chạy (chế độ tập, giọng, tự duyệt/đăng) để bộ mới chạy y như vậy; bật autopilot. */
export function seriesSettingsFrom(template: Series | undefined) {
  if (!template) return { autopilot: true, autoApprove: true, autoPublish: true };
  const { targetWords, autoApprove, chaptersPerDay, episodeChapters, ttsVoice, makeShort, autoPublish, voiceStyle } = template;
  return { targetWords, autoApprove, chaptersPerDay, episodeChapters, ttsVoice, makeShort, autoPublish, voiceStyle, autopilot: true };
}
