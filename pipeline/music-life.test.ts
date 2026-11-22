import path from "node:path";
import { describe, expect, it } from "vitest";
import { lifeMusicCredit, lifeMusicTracks, seededOrder } from "./render";

describe("nhạc cảm xúc chuyện đời", () => {
  it("có bài và ghi công đủ từng bài (CC BY)", async () => {
    const tracks = await lifeMusicTracks();
    expect(tracks.length).toBeGreaterThanOrEqual(8);
    const credit = lifeMusicCredit(tracks);
    // path.basename: máy Windows cho đường dẫn dấu `\`, tách tay bằng "/" là trượt tên bài.
    for (const t of tracks) expect(credit).toContain(path.basename(t, ".mp3"));
    expect(credit).toContain("Kevin MacLeod");
    expect(credit).toContain("creativecommons.org/licenses/by/4.0");
  });
  it("xáo theo seed: cùng seed cùng thứ tự, đủ phần tử", () => {
    const a = seededOrder([1, 2, 3, 4, 5, 6], 88);
    expect(seededOrder([1, 2, 3, 4, 5, 6], 88)).toEqual(a);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seededOrder([1, 2, 3, 4, 5, 6], 89)).not.toEqual(a);
  });
});

describe("cắt cảnh chuyện đời", () => {
  it("khung máy ảo nằm trong ảnh, khung đầu là toàn cảnh", async () => {
    const { LIFE_FRAMES, LIFE_SHOT_SECONDS } = await import("./render");
    expect(LIFE_FRAMES[0]).toEqual({ x: 0, y: 0, w: 1 });
    for (const f of LIFE_FRAMES) {
      expect(f.x + f.w).toBeLessThanOrEqual(1);
      expect(f.y + f.w).toBeLessThanOrEqual(1);
    }
    expect(LIFE_SHOT_SECONDS).toBeLessThanOrEqual(10);
  });
});

describe("mở đầu kiểu Short", () => {
  it("bỏ câu cuối mời nghe trên kênh, giữ hook", async () => {
    const { coldOpenText } = await import("./render");
    const t = coldOpenText("Đêm ấy con trai đuổi tôi ra khỏi nhà. Tôi ngồi ở bến xe với ba trăm nghìn. Nhưng sáng hôm sau, có một người đứng chờ tôi ở cổng. Nghe trọn câu chuyện trên kênh nhé.");
    expect(t).toContain("Đêm ấy con trai đuổi tôi");
    expect(t).toContain("đứng chờ tôi ở cổng");
    expect(t).not.toMatch(/kênh/);
  });
});
