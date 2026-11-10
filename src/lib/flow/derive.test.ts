import { describe, expect, it } from "vitest";
import {
  configuredImageModel,
  containingCompilation,
  describeRoute,
  firstUsableRoute,
  imageBrand,
  imageCounts,
  musicTitle,
  pickImageModel,
  thousands,
  type CompilationRef,
} from "./derive";

describe("pickImageModel", () => {
  const usage = [
    { model: "gemini-3.8-flash", calls: 20 },
    { model: "@cf/black-forest-labs/flux-1-schnell", calls: 4 },
    { model: "gpt-image (gói)", calls: 9 },
  ];
  it("ưu tiên model pipeline ghi lúc vẽ", () => {
    expect(pickImageModel({ tracked: "gpt-image (gói)", usage, configured: "@cf/black-forest-labs/flux-1-schnell" })).toEqual({ model: "gpt-image (gói)", source: "tracked" });
  });
  it("không có tracked: lấy AI vẽ nhiều lượt nhất trong ngày, bỏ qua model chữ", () => {
    expect(pickImageModel({ tracked: undefined, usage, configured: "x" })).toEqual({ model: "gpt-image (gói)", source: "usage" });
  });
  it("bỏ tiền tố @cf/… khi suy từ usage", () => {
    expect(pickImageModel({ tracked: "  ", usage: [{ model: "@cf/black-forest-labs/flux-1-schnell", calls: 2 }], configured: "x" })).toEqual({ model: "flux-1-schnell", source: "usage" });
  });
  it("lượt 0 (chỉ bị chặn quota) không tính; hết dữ liệu thì dùng model cấu hình", () => {
    const r = pickImageModel({ tracked: null, usage: [{ model: "gpt-image (gói)", calls: 0 }], configured: "@cf/black-forest-labs/flux-1-schnell" });
    expect(r).toEqual({ model: "flux-1-schnell", source: "configured" });
  });
});

describe("configuredImageModel", () => {
  const cf = [{ provider: "cloudflare" as const, model: "" }];
  it("có CODEX_AUTH_JSON mà chưa xếp Codex → Codex lên đầu (giống pipeline/images.ts)", () => {
    expect(configuredImageModel(cf, true)).toBe("gpt-image (gói)");
  });
  it("không có Codex → AI đầu danh sách, model rỗng dùng mặc định", () => {
    expect(configuredImageModel(cf, false)).toBe("@cf/black-forest-labs/flux-1-schnell");
    expect(configuredImageModel([{ provider: "openai", model: "gpt-image-2" }], false)).toBe("gpt-image-2");
  });
  it("Codex đã xếp sau Cloudflare thì giữ thứ tự người dùng", () => {
    expect(configuredImageModel([...cf, { provider: "codex", model: "" }], true)).toBe("@cf/black-forest-labs/flux-1-schnell");
  });
});

describe("musicTitle", () => {
  const credit = (t: string) => `Mô tả\n\nNhạc nền: "${t}" – Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons`;
  it("đọc tên bài từ dòng ghi công", () => {
    expect(musicTitle(credit("Dark Fog"))).toBe("Dark Fog");
  });
  it("chấp nhận nháy cong và lấy bài đầu khi bản gộp có nhiều khối", () => {
    expect(musicTitle(`a\n\nNhạc nền: “Echoes of Time” – K\n\nNhạc nền: "Other" – K`)).toBe("Echoes of Time");
  });
  it("không có dòng nhạc / rỗng → null", () => {
    expect(musicTitle("chỉ là mô tả")).toBeNull();
    expect(musicTitle(undefined)).toBeNull();
  });
});

describe("containingCompilation", () => {
  const ref = (id: number, videoIds: number[]): CompilationRef => ({ id, from: 1, to: 5, videoIds, youtubeVideoId: null, status: "ready" });
  it("tìm bản gộp chứa video, ưu tiên bản mới nhất", () => {
    expect(containingCompilation(7, [ref(40, [5, 6, 7]), ref(52, [7, 8]), ref(60, [9])])?.id).toBe(52);
  });
  it("không bản gộp nào chứa → null", () => {
    expect(containingCompilation(7, [ref(40, [1, 2])])).toBeNull();
    expect(containingCompilation(7, [])).toBeNull();
  });
  it("bỏ qua chính video đó (bản gộp tự chứa mình)", () => {
    expect(containingCompilation(40, [ref(40, [40, 41])])).toBeNull();
  });
});

describe("route / brand / count", () => {
  it("firstUsableRoute: AI đầu có key, không ai có key thì đầu chuỗi, chuỗi rỗng null", () => {
    const chain = [{ provider: "claude-cli" as const, model: "haiku" }, { provider: "gemini" as const, model: "" }];
    expect(firstUsableRoute(chain, ["gemini"])?.provider).toBe("gemini");
    expect(firstUsableRoute(chain, [])?.provider).toBe("claude-cli");
    expect(firstUsableRoute([], ["gemini"])).toBeNull();
  });
  it("describeRoute: model + logo hãng, model rỗng dùng tên nhà cung cấp", () => {
    expect(describeRoute({ provider: "claude-cli", model: "haiku" })).toEqual({ label: "haiku", brand: "claude" });
    expect(describeRoute({ provider: "codex-cli", model: "" }).brand).toBe("openai");
  });
  it("imageBrand", () => {
    expect(imageBrand("gpt-image (gói)")).toBe("openai");
    expect(imageBrand("flux-1-schnell")).toBe("cloudflare");
    expect(imageBrand("FLUX-1-schnell")).toBeNull();
  });
  it("imageCounts: ưu tiên bộ đếm, rồi đếm file cảnh, rồi null", () => {
    const sc = (i: number, file?: string) => ({ i, start: 0, end: 1, text: "", prompt: "", action: false, ...(file ? { file } : {}) });
    const base = { log: [] };
    expect(imageCounts({ steps: { images: { state: "run", long: { done: 18, total: 30 }, short: { done: 3, total: 5 }, ...base } } })).toEqual({ done: 21, total: 35 });
    expect(imageCounts({ steps: {}, scenes: { long: [sc(0, "a.jpg"), sc(1)], short: [] } })).toEqual({ done: 1, total: 2 });
    expect(imageCounts({ steps: {} })).toBeNull();
  });
  it("thousands định dạng cố định", () => {
    expect(thousands(5840)).toBe("5.840");
    expect(thousands(12)).toBe("12");
    expect(thousands(1234567)).toBe("1.234.567");
  });
});
