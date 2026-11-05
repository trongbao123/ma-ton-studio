import { describe, expect, it } from "vitest";
import { toWav } from "./tts";
import { cuesForChunk, packChunks, sentences } from "./text";

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
