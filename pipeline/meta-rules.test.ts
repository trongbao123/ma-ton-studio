import { describe, expect, it } from "vitest";
import { fixSchema } from "@/lib/seo-optimize";
import { metaSchema as compileSchema } from "./compile";
import { episodeSchema } from "./episode";
import { COLD_OPEN_RULE, HOOK_TITLE_RULE, NO_NAME_RULE } from "@/lib/meta-rules";
import { metaSchema } from "./prompts";
import { rethumbSchema } from "./rethumb";

const desc = (s: { shape: Record<string, { description?: string }> }, k: string) => s.shape[k]?.description ?? "";

describe("tiêu đề + chữ thumbnail nói ra bàn tay vàng", () => {
  it("chữ thumbnail cấm tên nhân vật ở mọi nơi sinh thumbnail", () => {
    for (const s of [episodeSchema, metaSchema, compileSchema, rethumbSchema]) expect(desc(s, "thumbnailText")).toContain(NO_NAME_RULE);
  });
  it("tiêu đề mở bằng bàn tay vàng + con số", () => {
    for (const s of [episodeSchema, metaSchema, compileSchema, fixSchema]) expect(desc(s, "title")).toContain(HOOK_TITLE_RULE);
  });
  it("tiêu đề Short không bắt buộc tên nhân vật nữa", () => {
    for (const s of [episodeSchema, metaSchema, fixSchema]) {
      expect(desc(s, "shortTitle")).toContain(HOOK_TITLE_RULE);
      expect(desc(s, "shortTitle")).not.toContain("tên nhân vật chính hoặc");
    }
  });
  it("mở đầu tập theo nhịp 0–3 / 3–20 giây, không gắn cứng tên truyện", () => {
    const d = desc(episodeSchema, "coldOpen");
    expect(d).toContain(COLD_OPEN_RULE);
    expect(COLD_OPEN_RULE).toContain("3–20 giây");
    expect(d).not.toContain("Lâm Uyên");
    expect(desc(episodeSchema, "hookText")).toContain(NO_NAME_RULE);
  });
});
