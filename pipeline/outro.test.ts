import { describe, expect, it } from "vitest";
import { OUTRO_CARD_SLOTS, OUTRO_MARGIN_X, OUTRO_SECONDS, OUTRO_TEXT_RIGHT, outroArgs, outroLines } from "./outro";
import { AUDIO_BITRATE, AUDIO_RATE, STILL_FPS, STILL_TIMESCALE } from "./still";

const base = { img: "cuoi.jpg", out: "outro.mp4", font: "pipeline/fonts/BeVietnamPro-Bold.ttf", w: 1920, h: 1080 };

describe("outroLines", () => {
  const lines = outroLines("15h");
  it("kêu gọi đủ 3 việc: thích, chia sẻ, đăng ký", () => {
    const all = lines.map((l) => l.text).join(" ").toLowerCase();
    expect(all).toContain("đăng ký");
    expect(all).toContain("chia sẻ");
    expect(all).toContain("thích");
  });
  it("nói rõ giờ đăng để người xem biết khi nào quay lại", () => {
    expect(lines.map((l) => l.text).join(" ")).toContain("15h");
  });
  it("hiện lần lượt, không đổ ra cùng lúc", () => {
    const ats = lines.map((l) => l.at);
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    expect(new Set(ats).size).toBe(ats.length);
  });
  it("chữ cuối vẫn kịp hiện trước khi màn kết hết", () => {
    expect(Math.max(...lines.map((l) => l.at))).toBeLessThan(OUTRO_SECONDS - 2);
  });
  it("không dùng emoji — phông Be Vietnam Pro không có, drawtext sẽ ra ô vuông", () => {
    for (const l of lines) expect(l.text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe("chừa chỗ cho thẻ End Screen của YouTube", () => {
  it("mọi ô thẻ nằm hẳn bên phải, không đè vùng chữ", () => {
    for (const s of OUTRO_CARD_SLOTS) expect(s.x).toBeGreaterThanOrEqual(OUTRO_TEXT_RIGHT);
  });
  it("ô thẻ nằm trong khung hình", () => {
    for (const s of OUTRO_CARD_SLOTS) {
      expect(s.x + s.w).toBeLessThanOrEqual(1920);
      expect(s.y + s.h).toBeLessThanOrEqual(1080);
    }
  });
  it("KHÔNG vẽ ô placeholder vào video — chưa đặt thẻ trong Studio thì ô rỗng trông như lỗi", () => {
    const g = outroArgs(base).join(" ");
    for (const s of OUTRO_CARD_SLOTS) expect(g).not.toContain(`drawbox=x=${s.x}`);
  });
  it("chữ căn trái trong cột trái, chừa hẳn phần phải", () => {
    const graph = outroArgs(base).join(" ");
    expect(graph).toContain(`x=${OUTRO_MARGIN_X}`);
    expect(OUTRO_TEXT_RIGHT).toBeLessThan(Math.min(...OUTRO_CARD_SLOTS.map((s) => s.x)) + 1);
  });
});

describe("outroArgs", () => {
  const args = outroArgs(base);
  const graph = args[args.indexOf("-filter_complex") + 1];

  it("ra đúng thông số tập để ghép concat copy (24 fps, yuv420p, aac 192k 48k stereo, timescale 12288)", () => {
    expect(args[args.indexOf("-r") + 1]).toBe(String(STILL_FPS));
    expect(args[args.indexOf("-video_track_timescale") + 1]).toBe(STILL_TIMESCALE);
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args[args.indexOf("-b:a") + 1]).toBe(AUDIO_BITRATE);
    expect(args[args.indexOf("-ar") + 1]).toBe(AUDIO_RATE);
    expect(args[args.indexOf("-ac") + 1]).toBe("2");
    expect(graph).toContain("format=yuv420p");
  });

  it("luôn có luồng tiếng — không nhạc thì tiếng im, không thì concat copy vỡ vì khác luồng", () => {
    expect(outroArgs(base).join(" ")).toContain("anullsrc");
    expect(outroArgs({ ...base, music: "nhac.mp3" }).join(" ")).not.toContain("anullsrc");
  });

  it("có nhạc thì lặp đủ dài rồi mờ dần ở cuối", () => {
    const a = outroArgs({ ...base, music: "nhac.mp3" });
    expect(a.slice(a.indexOf("-stream_loop"), a.indexOf("-stream_loop") + 2)).toEqual(["-stream_loop", "-1"]);
    expect(a.join(" ")).toContain("afade=t=out");
  });

  it("nền phóng chậm và làm tối để chữ đọc được", () => {
    expect(graph).toContain("zoompan");
    expect(graph).toMatch(/eq=brightness=-0\.\d+/);
  });

  // Đo thật: chỉ hạ `eq` thì chữ vàng trên nền vàng/sáng không đọc được — phải có lớp phủ đen phủ kín khung.
  it("phủ một lớp đen lên CẢ khung, không chỉ hạ sáng", () => {
    expect(graph).toMatch(/drawbox=x=0:y=0:w=iw:h=ih:color=black@0\.\d+:t=fill/);
  });
  it("lớp phủ nằm dưới chữ, không đè lên chữ", () => {
    expect(graph.indexOf("drawbox")).toBeLessThan(graph.indexOf("drawtext"));
  });

  it("mỗi dòng chữ một drawtext, hiện lần lượt đúng mốc của nó", () => {
    const lines = outroLines("15h");
    expect(graph.match(/drawtext=/g)).toHaveLength(lines.length);
    for (const l of lines) expect(graph).toContain(`lt(t,${l.at})`);
  });

  it("dấu nháy và hai chấm trong chữ được thoát, không làm vỡ filter", () => {
    const g = outroArgs({ ...base, lines: [{ text: "Nghe: 'tập mới'", size: 60, color: "white", at: 1 }] }).join(" ");
    expect(g).not.toMatch(/text='Nghe: /);
    expect(g).toContain("\\:");
  });

  it("máy thiếu drawtext (BURN_TEXT=0) vẫn dựng được nền, chỉ không có chữ", () => {
    const g = outroArgs({ ...base, burnText: false }).join(" ");
    expect(g).not.toContain("drawtext");
    expect(g).toContain("zoompan");
  });

  it("mờ ra đen ở cuối cho khớp cách nối đoạn của chương", () => {
    expect(graph).toContain("fade=t=out");
  });

  it("đủ dài để YouTube nhận mốc mục lục (>= 10 giây)", () => {
    expect(OUTRO_SECONDS).toBeGreaterThanOrEqual(10);
  });
});
