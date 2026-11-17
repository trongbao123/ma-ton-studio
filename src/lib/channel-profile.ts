/**
 * Hồ sơ nội dung theo kênh: mỗi kênh một ngách (kênh gốc = tiên hiệp, "chuyen-doi" = chuyện đời / tâm lý).
 * Những chỗ chữ cố định kiểu tiên hiệp (hashtag, tên playlist, câu kêu gọi) đọc từ đây thay vì viết cứng.
 */
export type ChannelProfile = {
  /** Thể loại tổng quát cho tên playlist: "Truyện Audio Tu Tiên". */
  playlistLabel: string;
  /** Hashtag cố định đầu mô tả. */
  hashtags: string[];
  /** Hashtag cho Short. */
  shortHashtags: string[];
  /** Mỗi video dài cách nhau ít nhất ngần này ngày (1 = mỗi ngày). */
  publishEveryDays: number;
  /** Nhịp đăng nói trong bình luận kêu gọi đăng ký. */
  cadence: string;
};

const MAIN: ChannelProfile = {
  playlistLabel: "Truyện Audio Tu Tiên",
  hashtags: ["#TruyenAudio", "#TruyenTuTien", "#TienHiep"],
  shortHashtags: ["#shorts", "#truyentutien", "#truyenaudio"],
  publishEveryDays: 1,
  cadence: "tập mới mỗi ngày",
};

const PROFILES: Record<string, ChannelProfile> = {
  main: MAIN,
  "chuyen-doi": {
    playlistLabel: "Chuyện Đời Audio",
    hashtags: ["#ChuyenDoi", "#CauChuyenCuocSong", "#TruyenAudio"],
    shortHashtags: ["#shorts", "#chuyendoi", "#cauchuyencuocsong"],
    // Kế hoạch thử 4 tuần (11/2026): 10 video / 28 ngày ≈ 3 ngày một truyện.
    publishEveryDays: 3,
    cadence: "chuyện mới mỗi tuần",
  },
};

export const channelProfile = (ch: string | null | undefined): ChannelProfile => PROFILES[ch ?? "main"] ?? MAIN;
