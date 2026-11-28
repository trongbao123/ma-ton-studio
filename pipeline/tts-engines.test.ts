import { afterEach, describe, expect, it, vi } from "vitest";

// Nạp render.ts (nặng) có lúc quá 5 giây khi chạy cả bộ song song.
const load = () => import("./render");

describe("chọn bộ máy đọc", { timeout: 30_000 }, () => {
  afterEach(() => vi.unstubAllEnvs());

  it("chuyện đời: VieNeu trước, ivoi dự phòng; người kể theo giới tính", async () => {
    vi.stubEnv("IVOI_API_KEY", "x");
    const { narratorEngines } = await load();
    const { LIFE_TTS_VOICE_FEMALE } = await import("@/lib/story/life");
    const male = narratorEngines({ life: true, history: false, voice: "Algenib" });
    expect(male.map((e) => e.name)).toEqual(["VieNeu", "ivoi"]);
    expect(male[0].narrator).toBe("Đức Trí");
    expect(narratorEngines({ life: true, history: false, voice: LIFE_TTS_VOICE_FEMALE })[0].narrator).toBe("Thục Đoan");
  });

  it("lịch sử: Thanh Bình", async () => {
    const { narratorEngines } = await load();
    expect(narratorEngines({ life: false, history: true, voice: "" })[0]).toMatchObject({ name: "VieNeu", narrator: "Thanh Bình" });
  });

  it("TTS_ENGINE=ivoi bỏ VieNeu; =gemini bỏ cả hai; truyện thường không dùng bộ máy ngoài", async () => {
    vi.stubEnv("IVOI_API_KEY", "x");
    const { narratorEngines } = await load();
    vi.stubEnv("TTS_ENGINE", "ivoi");
    expect(narratorEngines({ life: true, history: false, voice: "" }).map((e) => e.name)).toEqual(["ivoi"]);
    vi.stubEnv("TTS_ENGINE", "gemini");
    expect(narratorEngines({ life: true, history: false, voice: "" })).toEqual([]);
    vi.stubEnv("TTS_ENGINE", "");
    expect(narratorEngines({ life: false, history: false, voice: "" })).toEqual([]);
  });

  it("tên file giọng có dấu/khoảng trắng an toàn; tên cũ giữ nguyên (không mất cache)", async () => {
    const { fileSafe } = await load();
    expect(fileSafe("vieneu-Đức Trí")).toBe("vieneu-Duc_Tri");
    expect(fileSafe("ivoi-vi_male_ngocngan_ipa")).toBe("ivoi-vi_male_ngocngan_ipa");
    expect(fileSafe("Algenib")).toBe("Algenib");
  });
});
