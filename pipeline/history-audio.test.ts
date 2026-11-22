import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Shot } from "@/lib/story/storyboard";
import { drumBeats, historyAudioArgs, HISTORY_MUSIC_MOODS, moodOfShot, musicPlan, shoutBeats } from "./history-audio";

const shot = (o: Partial<Shot> & { start: number; end: number }): Shot => ({ kind: "map", from: 0, to: 1, camera: "hold", sfx: [], ...o });

describe("chọn nhạc theo cảnh", () => {
  it("cảnh có giao chiến là nhạc trận, hành quân là nhạc đi đường, thẻ chữ là nhạc trầm, cảnh cuối là nhạc kết", () => {
    expect(moodOfShot(shot({ start: 0, end: 4, battles: ["Ngọc Hồi"] }), false)).toBe("battle");
    expect(moodOfShot(shot({ start: 0, end: 4, route: ["A", "B"] }), false)).toBe("march");
    expect(moodOfShot(shot({ start: 0, end: 4, kind: "card" }), false)).toBe("calm");
    expect(moodOfShot(shot({ start: 0, end: 4 }), true)).toBe("elegy");
  });

  it("mỗi mood có ít nhất một bài trong kho nhạc", () => {
    for (const files of Object.values(HISTORY_MUSIC_MOODS)) expect(files.length).toBeGreaterThan(0);
  });
});

describe("dải nhạc nền", () => {
  it("các cảnh liền nhau cùng mood gộp thành một đoạn nhạc", () => {
    const plan = musicPlan([
      shot({ start: 0, end: 4, route: ["A", "B"] }),
      shot({ start: 4, end: 8, route: ["B", "C"] }),
      shot({ start: 8, end: 12, route: ["C", "D"] }),
      shot({ start: 12, end: 16, battles: ["D"] }),
    ]);
    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({ start: 0, end: 12 });
    expect(plan[1]).toMatchObject({ start: 12, end: 16 });
  });

  it("cảnh cuối dùng nhạc kết", () => {
    const plan = musicPlan([shot({ start: 0, end: 5, kind: "card" }), shot({ start: 5, end: 10, kind: "art" })]);
    expect(HISTORY_MUSIC_MOODS.elegy).toContain(path.basename(plan.at(-1)!.file));
  });
});

describe("trống trận và tiếng hô", () => {
  it("trống dồn mở đầu, thêm một nhịp mỗi cảnh giao chiến", () => {
    const shots = [shot({ start: 0, end: 4 }), shot({ start: 4, end: 8, battles: ["X"] }), shot({ start: 8, end: 12, battles: ["Y"] })];
    const beats = drumBeats(shots, 12);
    expect(beats.filter((b) => b < 2)).not.toHaveLength(0);
    expect(beats).toContain(4);
    expect(beats).toContain(8);
  });

  it("tiếng hô chỉ ở cảnh được đạo diễn đánh dấu, và nằm trong độ dài video", () => {
    // Cảnh thứ ba bắt đầu sau khi giọng đọc đã hết (video dài 10 giây) → không kêu.
    const shots = [shot({ start: 0, end: 4, sfx: ["shout"] }), shot({ start: 4, end: 8 }), shot({ start: 12, end: 20, sfx: ["shout"] })];
    const beats = shoutBeats(shots, 10);
    expect(beats).toHaveLength(1);
    expect(beats[0]).toBeLessThan(10);
  });
});

describe("lệnh trộn tiếng", () => {
  it("có ducking khi có giọng, có nhạc, trống và xuất aac", () => {
    const shots = [shot({ start: 0, end: 6, battles: ["X"], sfx: ["shout"] })];
    const args = historyAudioArgs({ voice: "voice.wav", video: "v.mp4", shots, seconds: 6, out: "out.mp4" });
    const graph = args.join(" ");
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("-c:a");
    expect(graph).toContain("aac");
    expect(args).toContain("voice.wav");
  });
});
