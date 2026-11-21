import { describe, expect, it } from "vitest";
import { channelProfile, titleMatches } from "./channel-profile";

describe("hồ sơ kênh lịch sử", () => {
  it("kênh lich-su có tên, nhịp đăng, hashtag, playlist riêng (không rơi về tiên hiệp)", () => {
    const p = channelProfile("lich-su");
    expect(p.youtubeTitle).toBe("Sử Ký Kể Chuyện");
    expect(p.publishEveryDays).toBe(3);
    expect(p.hashtags).toContain("#LichSu");
    expect(p.playlistLabel).toBe("Lịch Sử Kể Chuyện");
  });

  it("nhận tên kênh không phân biệt hoa thường", () => {
    expect(titleMatches("lich-su", "sử ký kể chuyện")).toBe(true);
  });
});
