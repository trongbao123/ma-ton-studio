import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { artCredits, isUsableArtwork, pickArtwork, type ArtImage } from "./scene-art";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const page = (title: string, license: string, width = 1600) => ({
  title,
  imageinfo: [{ thumburl: `https://upload.wikimedia.org/${encodeURIComponent(title)}.jpg`, width, extmetadata: { LicenseShortName: { value: license }, Artist: { value: "<a>Hoạ sĩ vô danh</a>" } } }],
});

describe("chọn tranh tư liệu", () => {
  it("loại ảnh chụp hiện đại, ảnh lạc đề và giấy phép không tự do", () => {
    const topic = ["Tây Sơn", "Quang Trung"];
    expect(isUsableArtwork({ title: "File:Battle at the River Tho-xuong Tây Sơn.jpg", license: "Public domain", width: 1600 }, topic)).toBe(true);
    expect(isUsableArtwork({ title: "File:Tượng đài Quang Trung.jpg", license: "Public domain", width: 1600 }, topic)).toBe(false);
    expect(isUsableArtwork({ title: "File:Bảo tàng Quang Trung IMG_1234.jpg", license: "CC BY-SA 3.0", width: 1600 }, topic)).toBe(false);
    expect(isUsableArtwork({ title: "File:Gather Ye Rosebuds While Ye May.jpg", license: "Public domain", width: 1600 }, topic)).toBe(false);
    expect(isUsableArtwork({ title: "File:Tây Sơn painting.jpg", license: "CC BY-NC 2.0", width: 1600 }, topic)).toBe(false);
    expect(isUsableArtwork({ title: "File:Tây Sơn painting.jpg", license: "Public domain", width: 400 }, topic)).toBe(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("tải được tranh hợp lệ, bỏ tranh không hợp", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "art-"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).includes("api.php")
          ? json({ query: { pages: { "1": page("File:Tượng đài Quang Trung.jpg", "Public domain"), "2": page("File:Trận Tây Sơn.jpg", "Public domain") } } })
          : new Response(Buffer.alloc(40_000), { status: 200 }),
      ),
    );
    const found = await pickArtwork({ query: "Tây Sơn", topicTerms: ["Tây Sơn"], dir, want: 3 });
    expect(found.map((a) => a.title)).toEqual(["File:Trận Tây Sơn.jpg"]);
    expect(found[0]).toMatchObject({ synthetic: false, license: "Public domain" });
  });

  it("không có tranh nào hợp → trả rỗng để bên gọi cho AI vẽ", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "art-"));
    vi.stubGlobal("fetch", vi.fn(async () => json({ query: { pages: { "1": page("File:Tượng đài abc.jpg", "Public domain") } } })));
    expect(await pickArtwork({ query: "Tây Sơn", topicTerms: ["Tây Sơn"], dir, want: 3 })).toEqual([]);
  });
});

describe("ghi công ảnh", () => {
  it("mỗi ảnh một dòng có tác giả, giấy phép và link; ảnh AI vẽ ghi rõ là minh hoạ", () => {
    const images: ArtImage[] = [
      { file: "a.jpg", title: "File:Trận Tây Sơn.jpg", url: "https://commons.wikimedia.org/wiki/File:A", license: "Public domain", artist: "Vô danh", synthetic: false },
      { file: "b.jpg", title: "Minh hoạ", url: "", license: "", artist: "", synthetic: true },
    ];
    const credits = artCredits(images);
    expect(credits).toContain("File:Trận Tây Sơn.jpg");
    expect(credits).toContain("Public domain");
    expect(credits).toContain("https://commons.wikimedia.org/wiki/File:A");
    expect(credits).toMatch(/minh họa.*AI|AI.*minh họa/i);
  });
});
