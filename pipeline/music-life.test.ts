import { describe, expect, it } from "vitest";
import { lifeMusicCredit, lifeMusicTracks, seededOrder } from "./render";

describe("nhạc cảm xúc chuyện đời", () => {
  it("có bài và ghi công đủ từng bài (CC BY)", async () => {
    const tracks = await lifeMusicTracks();
    expect(tracks.length).toBeGreaterThanOrEqual(8);
    const credit = lifeMusicCredit(tracks);
    for (const t of tracks) expect(credit).toContain(t.split("/").pop()!.replace(/\.mp3$/, ""));
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
