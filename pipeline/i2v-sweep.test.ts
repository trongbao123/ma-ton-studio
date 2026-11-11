import { describe, expect, it } from "vitest";
import { CLIP_FRAMES } from "./i2v-plan";
import { SWEEP_STYLES, meanYdif, parseSsim, ssimArgs, sweepCells, sweepTable, ydifArgs } from "./i2v-sweep";

describe("sweepCells", () => {
  const cells = sweepCells({ motion: "qi aura erupting around him", endStrengths: [0, 0.3, 0.5], styles: ["effects", "action"] });

  it("một ô cho mỗi tổ hợp (kiểu prompt × độ khóa khung cuối), id tăng từ 0", () => {
    expect(cells).toHaveLength(6);
    expect(cells.map((c) => c.id)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("mỗi ô mang đúng độ khóa và prompt của kiểu đó", () => {
    const c = cells.find((x) => x.style === "action" && x.endStrength === 0.3)!;
    expect(c.prompt).toContain("qi aura erupting around him");
    expect(c.prompt).toContain(SWEEP_STYLES.action.suffix);
    expect(c.negative).toBe(SWEEP_STYLES.action.negative);
  });
  it("kiểu 'effects' giữ nguyên cách làm hiện tại: cấm nhân vật đổi tư thế", () => {
    expect(SWEEP_STYLES.effects.negative).toContain("changing pose");
    expect(SWEEP_STYLES.effects.suffix).toContain("keeps the same face");
  });
  it("kiểu 'action' cho phép hành động nhỏ nên KHÔNG cấm đổi tư thế, nhưng vẫn giữ mặt và cấm máy quay", () => {
    expect(SWEEP_STYLES.action.negative).not.toContain("changing pose");
    expect(SWEEP_STYLES.action.negative).toContain("deformed face");
    expect(SWEEP_STYLES.action.negative).toContain("camera movement");
    expect(SWEEP_STYLES.action.suffix).toContain("keeps the same face");
  });
  it("số khung mặc định bằng clip thật để đo ra số dùng được", () => {
    expect(new Set(cells.map((c) => c.frames))).toEqual(new Set([CLIP_FRAMES]));
  });
  it("dò cả số khung thì nhân thêm chiều đó", () => {
    const got = sweepCells({ motion: "m", endStrengths: [0, 0.5], styles: ["action"], frames: [73, 97] });
    expect(got).toHaveLength(4);
    expect(got.filter((c) => c.frames === 73)).toHaveLength(2);
  });
});

describe("đo chuyển động (YDIF)", () => {
  it("lệnh đo in YDIF từng khung, không xuất file", () => {
    const args = ydifArgs("clip.mp4");
    expect(args).toContain("clip.mp4");
    expect(args.join(" ")).toContain("signalstats");
    expect(args.join(" ")).toContain("lavfi.signalstats.YDIF");
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });
  it("lấy trung bình YDIF của các khung", () => {
    const log = ["lavfi.signalstats.YDIF=1.000", "lavfi.signalstats.YDIF=3.000", "lavfi.signalstats.YDIF=2.000"].join("\n");
    expect(meanYdif(log)).toBeCloseTo(2, 6);
  });
  it("không đọc được thì null (không trả 0 làm tưởng là clip đứng yên)", () => {
    expect(meanYdif("lỗi gì đó")).toBeNull();
  });
});

describe("đo trôi hình (SSIM khung cuối so với ảnh gốc)", () => {
  it("so 2 ảnh, in SSIM, không xuất file", () => {
    const args = ssimArgs("last.png", "goc.jpg");
    expect(args.join(" ")).toContain("ssim");
    expect(args.slice(-3)).toEqual(["-f", "null", "-"]);
  });
  it("đọc SSIM tổng (All) từ log ffmpeg", () => {
    expect(parseSsim("SSIM Y:0.912345 (10.58) U:0.98 V:0.97 All:0.934567 (11.83)")).toBeCloseTo(0.934567, 6);
  });
  it("không đọc được thì null", () => {
    expect(parseSsim("không có gì")).toBeNull();
  });
});

describe("sweepTable", () => {
  const cells = sweepCells({ motion: "m", endStrengths: [0, 0.5], styles: ["effects", "action"] });
  const rows = cells.map((c, i) => ({ cell: c, ok: i !== 1, seconds: 40 + i, ydif: i === 1 ? null : 1 + i, ssim: i === 1 ? null : 0.9 - i * 0.05 }));

  it("mỗi ô một dòng, có kiểu prompt, độ khóa, YDIF, SSIM, giây GPU", () => {
    const text = sweepTable(rows);
    expect(text.split("\n")).toHaveLength(rows.length + 1);
    expect(text).toContain("effects");
    expect(text).toContain("action");
    expect(text).toContain("YDIF");
  });
  it("ô lỗi ghi rõ là lỗi, không in số rỗng", () => {
    const line = sweepTable(rows).split("\n")[2];
    expect(line).toContain("LỖI");
    expect(line).not.toContain("null");
  });
});
