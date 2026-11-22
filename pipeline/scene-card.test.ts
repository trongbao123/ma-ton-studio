import { describe, expect, it } from "vitest";
import type { Shot } from "@/lib/story/storyboard";
import { cardFilterGraph } from "./scene-card";

const shot = (o: Partial<Shot> = {}): Shot => ({ kind: "card", from: 0, to: 1, start: 0, end: 4, camera: "hold", sfx: [], title: "1789", subtitle: "Tháng Giêng", ...o });

describe("thẻ chữ trên nền giấy cũ", () => {
  it("vẽ tiêu đề, dòng phụ và vệt cọ quét ngang", () => {
    const graph = cardFilterGraph(shot());
    expect(graph).toContain("1789");
    expect(graph).toContain("Tháng Giêng");
    expect(graph).toContain("drawbox");
  });

  it("thoát ký tự đặc biệt để ffmpeg không hiểu nhầm", () => {
    const graph = cardFilterGraph(shot({ title: "Ngày 5: 'Tết'", subtitle: "a\\b" }));
    // Dấu hai chấm phải đi sau dấu thoát; nháy đơn đổi thành nháy cong; dấu chéo ngược nhân đôi.
    expect(graph).toContain("Ngày 5\\:");
    expect(graph).not.toContain("'Tết'");
    expect(graph).toContain("a\\\\b");
  });

  it("không có dòng phụ thì không vẽ dòng phụ", () => {
    expect((cardFilterGraph(shot({ subtitle: undefined })).match(/drawtext/g) ?? []).length).toBe(1);
  });
});
