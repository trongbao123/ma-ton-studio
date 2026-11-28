import { describe, expect, it } from "vitest";
import { chunkCreditLines, COMMENT_MAX, commentTargets, creditCommentTargets, ctaComment, SHORT_DELAY_MS, type CreditCommentRow } from "./comment";

const base = {
  seriesTitle: "Ma Tôn Trùng Sinh",
  playlistUrl: "https://www.youtube.com/playlist?list=PL123",
  channelUrl: "https://www.youtube.com/channel/UCqhzR8PL3keqni2-kzbAoaw",
  publishHour: "15h",
};

describe("ctaComment", () => {
  it("kêu gọi đủ: thích, chia sẻ, đăng ký", () => {
    const t = ctaComment(base).toLowerCase();
    expect(t).toContain("thích");
    expect(t).toContain("chia sẻ");
    expect(t).toContain("đăng ký");
  });

  it("có link trọn bộ và link đăng ký kèm sub_confirmation", () => {
    const t = ctaComment(base);
    expect(t).toContain(base.playlistUrl);
    expect(t).toContain("sub_confirmation=1");
  });

  it("nói giờ đăng để người xem biết khi nào quay lại", () => {
    expect(ctaComment(base)).toContain("15h");
  });

  it("tập có số thì nhắc tập, không có thì không bịa", () => {
    expect(ctaComment({ ...base, episodeNo: 7 })).toContain("tập 7");
    expect(ctaComment(base).toLowerCase()).not.toContain("tập undefined");
  });

  it("không quá giới hạn ký tự của bình luận YouTube", () => {
    const t = ctaComment({ ...base, seriesTitle: "A".repeat(500), episodeNo: 999 });
    expect(t.length).toBeLessThanOrEqual(COMMENT_MAX);
  });

  it("không có thẻ góc nhọn (YouTube nuốt chữ trong <>)", () => {
    expect(ctaComment({ ...base, seriesTitle: "Ma <b>Tôn</b>" })).not.toMatch(/[<>]/);
  });

  it("thiếu playlist thì bỏ dòng đó, không để link rỗng", () => {
    const t = ctaComment({ ...base, playlistUrl: null });
    expect(t).not.toContain("null");
    expect(t).not.toMatch(/:\s*$/m);
  });
});

describe("ctaComment cho kênh lịch sử (phim tài liệu, không dùng câu chuyện đời)", () => {
  const historyBase = { ...base, cadence: "video mới mỗi 3 ngày", history: true };

  it("hỏi người xem muốn xem tiếp sự kiện/nhân vật nào — không nói 'câu chuyện'/'chạm lòng'", () => {
    const t = ctaComment(historyBase);
    expect(t.toLowerCase()).toContain("sự kiện hay nhân vật lịch sử");
    expect(t.toLowerCase()).not.toContain("câu chuyện");
    expect(t.toLowerCase()).not.toContain("chạm lòng");
    expect(t.toLowerCase()).not.toContain("gặp chuyện giống vậy");
  });

  it("vẫn mời thích/chia sẻ/đăng ký và dùng đúng nhịp đăng của hồ sơ kênh", () => {
    const t = ctaComment(historyBase).toLowerCase();
    expect(t).toContain("thích");
    expect(t).toContain("chia sẻ");
    expect(t).toContain("đăng ký");
    expect(t).toContain("video mới mỗi 3 ngày");
  });

  it("bản Short lịch sử cũng tránh câu 'câu chuyện'/'chạm lòng' của chuyện đời", () => {
    const t = ctaComment({ ...historyBase, short: true }).toLowerCase();
    expect(t).not.toContain("câu chuyện");
    expect(t).not.toContain("chạm lòng");
  });
});

describe("ctaComment cho Short", () => {
  it("bản Short ngắn hơn bản video dài — người lướt Shorts không đọc đoạn dài", () => {
    const long = ctaComment(base);
    const short = ctaComment({ ...base, short: true });
    expect(short.length).toBeLessThan(long.length);
  });
  it("vẫn mời đăng ký và vẫn có link trọn bộ", () => {
    const t = ctaComment({ ...base, short: true });
    expect(t.toLowerCase()).toContain("đăng ký");
    expect(t).toContain(base.playlistUrl);
  });
});

describe("commentTargets", () => {
  const at = (iso: string) => new Date(iso);
  const now = at("2026-11-12T10:00:00Z");

  it("tập đã phát, Short chưa tới giờ (Short sau 2 tiếng) → chỉ bình luận video dài", () => {
    const got = commentTargets({ youtubeVideoId: "L1", youtubeShortId: "S1", publishAt: at("2026-11-12T09:00:00Z"), meta: {} }, now);
    expect(got.map((t) => t.kind)).toEqual(["long"]);
  });

  it("qua 2 tiếng thì Short cũng được bình luận", () => {
    const got = commentTargets({ youtubeVideoId: "L1", youtubeShortId: "S1", publishAt: at("2026-11-12T07:00:00Z"), meta: {} }, now);
    expect(got.map((t) => t.kind)).toEqual(["long", "short"]);
    expect(got.find((t) => t.kind === "short")!.youtubeId).toBe("S1");
  });

  it("Short cắt cảnh (row riêng, không có video dài) dùng chính giờ phát của nó", () => {
    const got = commentTargets({ youtubeVideoId: null, youtubeShortId: "S9", publishAt: at("2026-11-12T09:00:00Z"), meta: {} }, now);
    expect(got.map((t) => t.kind)).toEqual(["short"]);
  });

  it("cái nào bình luận rồi thì bỏ qua, không đăng chồng", () => {
    const meta = { commentedAt: "2026-11-12T09:30:00Z" };
    const got = commentTargets({ youtubeVideoId: "L1", youtubeShortId: "S1", publishAt: at("2026-11-12T07:00:00Z"), meta }, now);
    expect(got.map((t) => t.kind)).toEqual(["short"]);
  });

  it("cả hai xong thì không còn việc", () => {
    const meta = { commentedAt: "x", shortCommentedAt: "y" };
    expect(commentTargets({ youtubeVideoId: "L1", youtubeShortId: "S1", publishAt: at("2026-11-12T07:00:00Z"), meta }, now)).toEqual([]);
  });

  it("chưa có lịch phát thì chưa bình luận gì", () => {
    expect(commentTargets({ youtubeVideoId: "L1", youtubeShortId: "S1", publishAt: null, meta: {} }, now)).toEqual([]);
  });

  it("Short chậm hơn video dài đúng 2 tiếng", () => {
    expect(SHORT_DELAY_MS).toBe(2 * 3600_000);
  });
});

describe("creditCommentTargets — video lịch sử nào cần đăng bù bình luận ghi công ảnh dư", () => {
  const now = new Date("2026-11-28T12:00:00Z");
  const creditRow = (o: Partial<CreditCommentRow>): CreditCommentRow => ({ id: 1, youtubeVideoId: "V1", publishAt: new Date("2026-11-28T00:00:00Z"), meta: { overflowCredits: ["- dòng ghi công"] }, ...o });

  it("đã công khai (publishAt <= now), có id YouTube, còn overflowCredits, chưa đăng → chọn", () => {
    expect(creditCommentTargets([creditRow({})], now).map((r) => r.id)).toEqual([1]);
  });

  it("publishAt trong tương lai (chưa công khai) → KHÔNG chọn (YouTube chưa nhận bình luận video riêng tư)", () => {
    expect(creditCommentTargets([creditRow({ publishAt: new Date("2026-12-01T00:00:00Z") })], now)).toEqual([]);
  });

  it("chưa có youtubeVideoId → KHÔNG chọn", () => {
    expect(creditCommentTargets([creditRow({ youtubeVideoId: null })], now)).toEqual([]);
  });

  it("overflowCredits rỗng hoặc không có → KHÔNG chọn (không có gì phải đăng bù)", () => {
    expect(creditCommentTargets([creditRow({ meta: { overflowCredits: [] } })], now)).toEqual([]);
    expect(creditCommentTargets([creditRow({ meta: {} })], now)).toEqual([]);
  });

  it("đã đăng rồi (creditsCommentedAt) → KHÔNG chọn lại, không đăng chồng", () => {
    expect(creditCommentTargets([creditRow({ meta: { overflowCredits: ["x"], creditsCommentedAt: "2026-11-28T01:00:00Z" } })], now)).toEqual([]);
  });
});

describe("chunkCreditLines — chia dòng ghi công thành nhiều đoạn, không bỏ dòng nào", () => {
  it("đủ ngắn thì gộp vào một đoạn", () => {
    expect(chunkCreditLines(["dòng 1", "dòng 2"], 1000)).toEqual([["dòng 1", "dòng 2"]]);
  });

  it("dài hơn ngân sách byte thì chia nhiều đoạn, không mất dòng nào, mỗi đoạn không vượt ngân sách", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `- File:Anh${i}.jpg — Tác giả — CC BY-SA 4.0 — https://commons.wikimedia.org/wiki/File:Anh${i}.jpg`);
    const chunks = chunkCreditLines(lines, 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(lines);
    for (const chunk of chunks) expect(Buffer.byteLength(chunk.join("\n"), "utf8")).toBeLessThanOrEqual(300);
  });

  it("danh sách rỗng → không có đoạn nào", () => {
    expect(chunkCreditLines([], 300)).toEqual([]);
  });
});
