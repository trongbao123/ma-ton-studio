import { describe, expect, it } from "vitest";
import { toWav } from "./tts";
import { alignSentenceEnds, cuesForChunk, packChunks, parseSilenceMids, sentences, snapToSentences, titleCardFilter, titleCardFontSize } from "./text";

describe("pipeline text", () => {
  it("tách câu và gom khối theo độ dài", () => {
    const s = sentences("Ta là Ma Tôn. Ngươi dám sao?\nHắn cười… Rồi im lặng");
    expect(s).toEqual(["Ta là Ma Tôn.", "Ngươi dám sao?", "Hắn cười…", "Rồi im lặng"]);
    expect(packChunks(s, 30).length).toBeGreaterThan(1);
  });

  it("chia thời lượng cue phủ đúng cả khối", () => {
    const cues = cuesForChunk(["Câu một.", "Câu thứ hai dài hơn."], 10, 6);
    expect(cues[0].start).toBe(10);
    expect(cues.at(-1)!.end).toBeCloseTo(16);
  });
});

describe("toWav", () => {
  it("gắn header cho PCM thô, giữ nguyên WAV", () => {
    const pcm = Buffer.alloc(480);
    const wav = toWav(pcm, "audio/L16;codec=pcm;rate=24000");
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(toWav(wav, "audio/wav")).toBe(wav);
  });
});

describe("titleCardFontSize", () => {
  it("chữ càng dài cỡ càng nhỏ, không bao giờ nhỏ quá đọc không nổi", () => {
    expect(titleCardFontSize("A", 1920)).toBeGreaterThan(titleCardFontSize("A".repeat(60), 1920));
    expect(titleCardFontSize("A".repeat(300), 1920)).toBeGreaterThanOrEqual(24);
  });
  it("đo theo dòng DÀI NHẤT khi xuống dòng", () => {
    expect(titleCardFontSize("ngắn\n" + "A".repeat(40), 1920)).toBe(titleCardFontSize("A".repeat(40), 1920));
  });
});

describe("titleCardFilter", () => {
  it("thẻ ở ĐẦU video: hiện từ giây 0", () => {
    const f = titleCardFilter({ text: "Tập 7", w: 1920, font: "f.ttf", start: 0 });
    expect(f).toContain("drawtext=");
    expect(f).toContain("enable='between(t,0,");
  });
  it("thẻ ở CUỐI intro: chỉ bật quanh mốc đó, không bật từ đầu video", () => {
    const f = titleCardFilter({ text: "Tập 7", w: 1920, font: "f.ttf", start: 32 });
    expect(f).toContain("between(t,32,");
    expect(f).not.toContain("between(t,0,");
  });
  it("hiện rồi tắt hẳn trong khoảng của nó — không dính sang chương sau", () => {
    const f = titleCardFilter({ text: "Tập 7", w: 1920, font: "f.ttf", start: 32, seconds: 5 });
    expect(f).toContain("between(t,32,37)");
  });
  it("thoát dấu trong tên truyện, không làm vỡ filter", () => {
    expect(titleCardFilter({ text: "Ma Đạo: Hồi 3", w: 1920, font: "f.ttf", start: 1 })).toContain("\:");
  });
});

describe("căn mốc theo giọng đọc thật", () => {
  it("alignSentenceEnds kéo mốc ước về khoảng lặng gần nhất, giữ tăng dần", () => {
    // 3 câu dài bằng nhau, 9 giây: ước 3 / 6 / 9; khoảng lặng thật ở 3.8 và 5.4.
    expect(alignSentenceEnds([10, 10, 10], 9, [3.8, 5.4])).toEqual([3.8, 5.4, 9]);
  });
  it("không có khoảng lặng trong cửa sổ thì giữ mốc ước", () => {
    expect(alignSentenceEnds([10, 10], 10, [1, 9.5])).toEqual([5, 10]);
  });
  it("mỗi khoảng lặng chỉ dùng cho một câu", () => {
    const got = alignSentenceEnds([10, 10, 10], 9, [4.2]);
    expect(got[0]).toBe(4.2);
    expect(got[1]).toBeGreaterThan(4.2);
  });
  it("parseSilenceMids lấy giữa khoảng lặng", () => {
    expect(parseSilenceMids("[silencedetect] silence_start: 1.5\n[silencedetect] silence_end: 2.1 | silence_duration: 0.6\nsilence_start: 4\nsilence_end: 4.4")).toEqual([1.8, 4.2]);
  });
  it("cuesForChunk dùng mốc khoảng lặng cho ranh giới câu", () => {
    const cues = cuesForChunk(["Câu một.", "Câu hai.", "Câu ba."], 10, 9, 90, [3.8, 5.4]);
    expect(cues.map((c) => +c.end.toFixed(2))).toEqual([13.8, 15.4, 19]);
  });
  it("snapToSentences dời ranh giới cảnh về mốc hết câu gần nhất, giữ trường khác", () => {
    const cues = [{ start: 0, end: 7, text: "Hắn rút kiếm." }, { start: 7, end: 9, text: "Gió nổi lên," }, { start: 9, end: 20, text: "trời tối sầm." }];
    const got = snapToSentences([{ start: 0, end: 10, zoom: true }, { start: 10, end: 20, zoom: false }], cues);
    expect(got).toEqual([{ start: 0, end: 7, zoom: true }, { start: 7, end: 20, zoom: false }]);
  });
});
