import { describe, expect, it } from "vitest";
import { edgeTone, TREE_EDGES } from "./edges";
import { CARD_ORDER, type CardId, type CardState, type CardView } from "./model";

const cardsWith = (states: Partial<Record<CardId, CardState>>) =>
  Object.fromEntries(CARD_ORDER.map((id) => [id, { id, state: states[id] ?? "wait" } as CardView])) as Record<CardId, CardView>;

describe("TREE_EDGES", () => {
  it("rẽ 4 nhánh sau SEO, hợp ở Dựng video, rẽ 2 nhánh rồi hợp ở YouTube", () => {
    const from = (id: CardId) => TREE_EDGES.filter(([a]) => a === id).map(([, b]) => b);
    const into = (id: CardId) => TREE_EDGES.filter(([, b]) => b === id).map(([a]) => a);
    expect(from("seo")).toEqual(["tts", "images", "i2v", "thumbnail"]);
    expect(into("video")).toEqual(["tts", "images", "i2v", "thumbnail"]);
    expect(from("video")).toEqual(["long", "short"]);
    expect(into("youtube")).toEqual(["long", "short"]);
    expect(TREE_EDGES).toHaveLength(14);
  });
});

describe("edgeTone", () => {
  it("dây thường theo trạng thái thẻ đích: đang chạy / xong / lỗi / chưa tới", () => {
    expect(edgeTone("seo", "tts", cardsWith({ tts: "run" }))).toBe("run");
    expect(edgeTone("seo", "tts", cardsWith({ tts: "done" }))).toBe("done");
    expect(edgeTone("seo", "tts", cardsWith({ tts: "error" }))).toBe("error");
    expect(edgeTone("seo", "tts", cardsWith({ tts: "wait", seo: "done" }))).toBe("idle");
    expect(edgeTone("seo", "short", cardsWith({ short: "skip" }))).toBe("idle");
  });

  it("dây vào thẻ hợp nhánh theo thẻ nguồn (nhánh nào xong thì dây đó xanh)", () => {
    const cards = cardsWith({ tts: "done", images: "run", thumbnail: "wait", video: "wait" });
    expect(edgeTone("tts", "video", cards)).toBe("done");
    expect(edgeTone("images", "video", cards)).toBe("run");
    expect(edgeTone("thumbnail", "video", cards)).toBe("idle");
  });
});
