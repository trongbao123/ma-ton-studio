import { describe, expect, it } from "vitest";
import { castVoices, faithful, groupTurns, ivoiSegments, NARRATOR, PACE, paceOf, stripTags, TURN_GAP, type Turn } from "./voice-cast";
import { IVOI_VOICE_FEMALE, IVOI_VOICES } from "./tts-ivoi";

const turns: Turn[] = [
  { speaker: NARRATOR, style: "slow", text: "Tôi năm nay năm mươi lăm tuổi. <sigh>" },
  { speaker: "Khoa", style: "cold", text: "Mẹ sang ở tạm nhà con Linh đi." },
  { speaker: NARRATOR, style: "", text: "Tôi đứng yên." },
  { speaker: "Linh", style: "awkward", text: "Nhà con có hai phòng." },
  { speaker: "ông Bảy", style: "warm", text: "Tôi biết thế nào bà cũng về." },
];
const script = {
  narrator: { gender: "female" as const, age: 55 },
  characters: [
    { name: "Khoa", gender: "male" as const, age: 33 },
    { name: "Linh", gender: "female" as const, age: 30 },
    { name: "ông Bảy", gender: "male" as const, age: 75 },
  ],
  turns,
};

describe("phân vai", () => {
  it("mẹ 55 tuổi giọng nữ trung niên, mỗi nhân vật một giọng khác nhau", () => {
    const cast = castVoices(script);
    expect(cast[NARRATOR]).toBe("Gacrux");
    expect(cast["ông Bảy"]).toBe("Algenib");
    expect(cast.Khoa).toBe("Charon");
    expect(new Set(Object.values(cast)).size).toBe(4);
  });
  it("nhóm gọi TTS tối đa 2 giọng", () => {
    const cast = castVoices(script);
    const groups = groupTurns(turns, cast);
    for (const g of groups) expect(new Set(g.map((t) => cast[t.speaker])).size).toBeLessThanOrEqual(2);
    expect(groups.flat()).toEqual(turns);
  });
  it("cắt nhóm theo độ dài", () => {
    const cast = { [NARRATOR]: "Gacrux" };
    const long = Array.from({ length: 5 }, () => ({ speaker: NARRATOR, style: "", text: "a".repeat(1000) }));
    expect(groupTurns(long, cast, 3000).map((g) => g.length)).toEqual([3, 2]);
  });
});

describe("giữ đúng chữ truyện", () => {
  const original = "Tôi năm nay năm mươi lăm tuổi.\n\n– Mẹ sang ở tạm nhà con Linh đi – Khoa nói.";
  it("chỉ thêm thẻ / đổi dấu → nhận", () => {
    expect(faithful(original, [
      { speaker: NARRATOR, style: "", text: "Tôi năm nay năm mươi lăm tuổi. <sigh>" },
      { speaker: "Khoa", style: "", text: "Mẹ sang ở tạm nhà con Linh đi" },
      { speaker: NARRATOR, style: "", text: "Khoa nói." },
    ])).toBe(true);
  });
  it("bỏ đoạn → không nhận", () => {
    expect(faithful(original, [{ speaker: NARRATOR, style: "", text: "Tôi năm nay năm mươi lăm tuổi." }])).toBe(false);
  });
  it("bỏ thẻ khi làm phụ đề", () => {
    expect(stripTags("Tôi đứng yên. <long pause> Rồi tôi đi.")).toBe("Tôi đứng yên. Rồi tôi đi.");
  });
});

describe("phân vai chuyện đời: người kể già đúng giới tính", () => {
  it("bà mẹ kể → Gacrux, con trai → giọng nam, không trùng người kể", () => {
    const cast = castVoices({
      narrator: { gender: "female", age: 60 },
      characters: [{ name: "Tuấn", gender: "male", age: 32 }, { name: "Lan", gender: "female", age: 30 }],
      turns: [{ speaker: "Tuấn", style: "", text: "Mẹ về quê đi." }, { speaker: "Lan", style: "", text: "Nhà chật lắm." }],
    });
    expect(cast.narrator).toBe("Gacrux");
    expect(["Charon", "Iapetus", "Orus", "Algenib", "Schedar", "Achird", "Puck", "Umbriel"]).toContain(cast.Tuấn);
    expect(["Sulafat", "Vindemiatrix", "Achernar", "Leda", "Aoede", "Despina"]).toContain(cast.Lan);
  });
});

describe("ivoi phân vai", () => {
  const turns = [
    { speaker: NARRATOR, style: "", text: "Tôi đứng yên. <sigh>" },
    { speaker: NARRATOR, style: "", text: "Cái muôi còn trong tay." },
    { speaker: "Khoa", style: "", text: "Mẹ đi đi." },
    { speaker: "Vy", style: "", text: "Con chào mẹ." },
    { speaker: "Linh", style: "", text: "Mẹ ở đây với con." },
    { speaker: NARRATOR, style: "", text: "Tôi gật đầu." },
  ];
  const script = {
    narrator: { gender: "female" as const, age: 60 },
    characters: [
      { name: "Khoa", gender: "male" as const, age: 33 },
      { name: "Vy", gender: "female" as const, age: 30 },
      { name: "Linh", gender: "female" as const, age: 28 },
    ],
    turns,
  };
  it("nhân vật nữ không trùng giọng người kể dù ivoi chỉ 2 giọng nữ", () => {
    const cast = castVoices(script, IVOI_VOICES);
    expect(cast[NARRATOR]).toBe(IVOI_VOICE_FEMALE);
    expect(cast.Vy).not.toBe(IVOI_VOICE_FEMALE);
    expect(cast.Linh).not.toBe(IVOI_VOICE_FEMALE);
    expect(cast.Khoa).toBe("vi_hoangnam_story_ipa");
  });
  it("gom lượt liền nhau cùng giọng, bỏ thẻ, giữ đủ chữ", () => {
    const cast = castVoices(script, IVOI_VOICES);
    const seg = ivoiSegments(turns, cast, 4000);
    // <sigh> → cắt đoạn + lặng thật; đổi người nói → ngừng một nhịp.
    expect(seg.map((s) => s.voice)).toEqual([IVOI_VOICE_FEMALE, IVOI_VOICE_FEMALE, "vi_hoangnam_story_ipa", "vi_female_quynh_anh", IVOI_VOICE_FEMALE]);
    expect(seg[0]).toMatchObject({ text: "Tôi đứng yên.", pauseAfter: 0.7 });
    expect(seg[1]).toMatchObject({ text: "Cái muôi còn trong tay.", pauseAfter: TURN_GAP });
    expect(seg[3].text).toBe("Con chào mẹ. Mẹ ở đây với con.");
    expect(seg.at(-1)!.pauseAfter).toBe(0);
  });
  it("tách đoạn khi vượt maxChars", () => {
    const seg = ivoiSegments([{ speaker: NARRATOR, style: "", text: "a".repeat(30) }, { speaker: NARRATOR, style: "", text: "b".repeat(30) }], { [NARRATOR]: "x" }, 50);
    expect(seg).toHaveLength(2);
  });
});

describe("ivoi nhấn nhá", () => {
  it("cảm xúc → nhịp đọc", () => {
    expect(paceOf("speaking slowly, holding back tears")).toBe(PACE.slow);
    expect(paceOf("trembling, choked up")).toBe(PACE.slow);
    expect(paceOf("cold, dismissive, impatient")).toBe(PACE.fast);
    expect(paceOf("")).toBe(PACE.normal);
  });
  it("cùng giọng nhưng đổi nhịp → tách đoạn; thẻ giữa câu → lặng giữa câu", () => {
    const seg = ivoiSegments(
      [
        { speaker: NARRATOR, style: "calm", text: "Tôi về nhà." },
        { speaker: NARRATOR, style: "holding back tears", text: "Con không ra mở cửa. <long pause> Tôi đứng đó." },
      ],
      { [NARRATOR]: "x" },
      4000,
    );
    expect(seg).toEqual([
      { voice: "x", text: "Tôi về nhà.", speed: PACE.normal, pauseAfter: 0 },
      { voice: "x", text: "Con không ra mở cửa.", speed: PACE.slow, pauseAfter: 1.2 },
      { voice: "x", text: "Tôi đứng đó.", speed: PACE.slow, pauseAfter: 0 },
    ]);
  });
});
