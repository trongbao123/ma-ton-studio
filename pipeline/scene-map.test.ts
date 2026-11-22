import { describe, expect, it } from "vitest";
import type { Shot } from "@/lib/story/storyboard";
import { baseLayersSvg, LABEL_MIN_GAP, layoutLabels, MAP_PALETTE, mapFrameSvg, type MapFrame } from "./scene-map";

const places = new Map([
  ["Tam Điệp, Ninh Bình", { lat: 20.15, lon: 105.9 }],
  ["Ngọc Hồi, Hà Nội", { lat: 20.94, lon: 105.84 }],
  ["Thăng Long, Hà Nội", { lat: 21.03, lon: 105.84 }],
]);

const shot: Shot = {
  kind: "map",
  from: 0,
  to: 2,
  start: 0,
  end: 6,
  camera: "hold",
  sfx: ["drum"],
  title: "ĐÊM 30 TẾT · 1789",
  subtitle: "QUÂN TÂY SƠN TIẾN RA BẮC",
  places: [...places.keys()],
  route: ["Tam Điệp, Ninh Bình", "Ngọc Hồi, Hà Nội", "Thăng Long, Hà Nội"],
  battles: ["Ngọc Hồi, Hà Nội"],
};

const shapes = { land: [[[105, 20], [106, 20], [106, 21], [105, 21]]], rivers: [[[105.5, 20], [105.6, 21]]], coast: [[[106, 20], [106, 21]]] };
const frame = (t: number): MapFrame => ({ shot, places, shapes, t, sprites: {} });

describe("khung hình cảnh bản đồ", () => {
  it("đầu cảnh chưa hiện địa danh cuối tuyến, cuối cảnh hiện đủ mọi địa danh", () => {
    expect(mapFrameSvg(frame(0))).not.toContain("THĂNG LONG");
    const last = mapFrameSvg(frame(shot.end));
    for (const name of ["TAM ĐIỆP", "NGỌC HỒI", "THĂNG LONG"]) expect(last).toContain(name);
  });

  it("không sinh toạ độ hỏng", () => {
    for (const t of [0, 1.5, 3, 4.5, 6]) expect(mapFrameSvg(frame(t))).not.toContain("NaN");
  });

  it("dùng bảng màu trầm của kênh và có thẻ chữ, hộp chữ đáy", () => {
    const svg = mapFrameSvg(frame(shot.end));
    expect(svg).toContain(MAP_PALETTE.route);
    expect(svg).toContain(MAP_PALETTE.sea);
    expect(svg).toContain("ĐÊM 30 TẾT · 1789");
    expect(svg).toContain("QUÂN TÂY SƠN TIẾN RA BẮC");
  });

  it("cảnh có giao chiến thì nổ ở đúng nơi, cảnh không có thì không nổ", () => {
    expect(mapFrameSvg(frame(shot.end))).toContain("data-burst");
    expect(mapFrameSvg({ ...frame(shot.end), shot: { ...shot, battles: [] } })).not.toContain("data-burst");
  });

  it("lính giấy chỉ hiện khi có sprite, và nhúng bằng ảnh", () => {
    expect(mapFrameSvg(frame(3))).not.toContain("<image");
    const withSprite = mapFrameSvg({ ...frame(3), sprites: { infantry: "data:image/png;base64,AAA" } });
    expect(withSprite).toContain('href="data:image/png;base64,AAA"');
  });
});

describe("nhãn địa danh không đè nhau", () => {
  // Như thực tế: một điểm xa (Tam Điệp) kéo khung rộng ra, 4 điểm Hà Nội dồn lại sát nhau.
  const near = new Map([
    ["Tam Điệp, Ninh Bình", { lat: 20.1537, lon: 105.9075 }],
    ["Hà Hồi, Hà Nội", { lat: 20.8989, lon: 105.848 }],
    ["Ngọc Hồi, Hà Nội", { lat: 20.9451, lon: 105.8443 }],
    ["Đống Đa, Hà Nội", { lat: 21.0121, lon: 105.8245 }],
    ["Thăng Long, Hà Nội", { lat: 21.0363, lon: 105.8403 }],
  ]);
  const crowded: Shot = { ...shot, places: [...near.keys()], route: [...near.keys()], battles: [] };

  it("các nhãn sát nhau được đẩy ra, cách nhau tối thiểu theo chiều dọc", () => {
    const laid = layoutLabels([...near.keys()].map((name, i) => ({ name, x: 900, y: 500 + i * 6, capital: i === 3, opacity: 1 })));
    const ys = laid.map((l) => l.labelY).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(LABEL_MIN_GAP);
  });

  it("nhãn bị đẩy xa thì có đường nối về đúng chấm địa danh", () => {
    const svg = mapFrameSvg({ ...frame(crowded.end), shot: crowded, places: near });
    expect(svg).toContain("data-leader");
  });
});

describe("dựng cảnh bản đồ không để rác", () => {
  it("vẽ nền MỘT lần cho cả cảnh, không dựng lại mỗi khung", () => {
    const base = baseLayersSvg(shapes, (lon: number, lat: number) => [lon, lat] as [number, number]);
    const first = mapFrameSvg({ ...frame(1), base });
    const second = mapFrameSvg({ ...frame(2), base });
    expect(first).toContain(base);
    expect(second).toContain(base);
  });
});
