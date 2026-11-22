import { describe, expect, it, vi } from "vitest";
import type { ArtImage } from "./scene-art";
import type { Shot } from "@/lib/story/storyboard";
import { historyQc, pickSceneRenderer, type SceneRenderers } from "./history-render";

const shot = (o: Partial<Shot> & { kind: Shot["kind"] }): Shot => ({ from: 0, to: 1, start: 0, end: 5, camera: "hold", sfx: [], ...o });
const art = (o: Partial<ArtImage> = {}): ArtImage => ({ file: "a.jpg", title: "File:A.jpg", url: "u", license: "Public domain", artist: "X", synthetic: false, ...o });

function renderers(over: Partial<SceneRenderers> = {}): SceneRenderers {
  return {
    terrain: vi.fn(async () => true),
    map: vi.fn(async () => {}),
    card: vi.fn(async () => {}),
    art: vi.fn(async () => {}),
    findArt: vi.fn(async () => [art()]),
    drawArt: vi.fn(async () => art({ synthetic: true })),
    ...over,
  };
}

describe("chọn cách dựng từng cảnh (lùi cấp khi thiếu dữ liệu)", () => {
  const places = new Map([["Tam Điệp, Ninh Bình", { lat: 20, lon: 105 }], ["Thăng Long, Hà Nội", { lat: 21, lon: 106 }]]);

  it("cảnh 3D hỏng → dựng bằng bản đồ 2D", async () => {
    const r = renderers({ terrain: vi.fn(async () => false) });
    await pickSceneRenderer({ shot: shot({ kind: "terrain", places: [...places.keys()] }), places, dir: "d", out: "o.mp4", renderers: r });
    expect(r.map).toHaveBeenCalled();
  });

  it("cảnh bản đồ nhưng không tra được địa danh nào → dựng thẻ chữ", async () => {
    const r = renderers();
    await pickSceneRenderer({ shot: shot({ kind: "map", places: ["Chỗ lạ"] }), places: new Map(), dir: "d", out: "o.mp4", renderers: r });
    expect(r.card).toHaveBeenCalled();
    expect(r.map).not.toHaveBeenCalled();
  });

  it("cảnh tranh nhưng Commons không có tranh hợp → cho AI vẽ, ảnh đánh dấu là minh hoạ", async () => {
    const r = renderers({ findArt: vi.fn(async () => []) });
    const used = await pickSceneRenderer({ shot: shot({ kind: "art", artQuery: "Tây Sơn" }), places, dir: "d", out: "o.mp4", renderers: r });
    expect(r.drawArt).toHaveBeenCalled();
    expect(used.images[0]?.synthetic).toBe(true);
  });

  it("AI vẽ cũng hỏng → lùi về thẻ chữ, KHÔNG ném lỗi giết cả job", async () => {
    const r = renderers({
      findArt: vi.fn(async () => []),
      drawArt: vi.fn(async () => {
        throw new Error("codex (gói) lỗi: prompt chỉ có dấu chấm");
      }),
    });
    const used = await pickSceneRenderer({ shot: shot({ kind: "art", artQuery: "Tây Sơn" }), places, dir: "d", out: "o.mp4", renderers: r });
    expect(used.kind).toBe("card");
    expect(r.card).toHaveBeenCalled();
  });

  it("cảnh tranh đạo diễn bỏ trống cả artQuery lẫn artPrompt → thẻ chữ, không phí lượt tìm/vẽ", async () => {
    const r = renderers();
    const used = await pickSceneRenderer({ shot: shot({ kind: "art" }), places, dir: "d", out: "o.mp4", renderers: r });
    expect(used.kind).toBe("card");
    expect(r.findArt).not.toHaveBeenCalled();
    expect(r.drawArt).not.toHaveBeenCalled();
  });

  it("tìm tranh trên Commons lỗi mạng → vẫn ra thẻ chữ", async () => {
    const r = renderers({ findArt: vi.fn(async () => { throw new Error("Commons 503"); }) });
    const used = await pickSceneRenderer({ shot: shot({ kind: "art", artPrompt: "chân dung Quang Trung" }), places, dir: "d", out: "o.mp4", renderers: r });
    expect(used.kind).toBe("card");
  });

  it("cảnh tranh có tranh thật → dùng tranh, không gọi AI vẽ", async () => {
    const r = renderers();
    const used = await pickSceneRenderer({ shot: shot({ kind: "art", artQuery: "Tây Sơn" }), places, dir: "d", out: "o.mp4", renderers: r });
    expect(r.drawArt).not.toHaveBeenCalled();
    expect(used.images[0]?.synthetic).toBe(false);
  });
});

describe("kiểm tra video trước khi đăng", () => {
  const ok = { seconds: 100, measured: 100.5, blackLog: "", shots: [shot({ kind: "map" })], images: [art()] };

  it("mọi thứ đạt → không có lỗi nào", async () => {
    expect(await historyQc(ok)).toEqual([]);
  });

  it("video lệch độ dài giọng đọc quá 2 giây → báo lỗi", async () => {
    expect((await historyQc({ ...ok, measured: 104 })).join(" ")).toMatch(/độ dài/i);
  });

  it("có khoảng đen → báo lỗi", async () => {
    expect((await historyQc({ ...ok, blackLog: "[blackdetect] black_start:12.5 black_end:14" })).join(" ")).toMatch(/đen/i);
  });

  it("ảnh tư liệu thiếu ghi công → báo lỗi", async () => {
    expect((await historyQc({ ...ok, images: [art({ license: "" })] })).join(" ")).toMatch(/ghi công|giấy phép/i);
  });
});
