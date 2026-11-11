import { describe, expect, it } from "vitest";
import { PUBLIC_PATHS } from "./public-routes";

describe("PUBLIC_PATHS", () => {
  // Hai route này do MÁY NGOÀI gọi (Vercel Cron, kernel Kaggle) nên không có cookie phiên.
  // Không miễn thì proxy trả 401 "Cần đăng nhập" trước khi vào route, và tính năng chết câm.
  it("route cho máy ngoài gọi phải được miễn đăng nhập", () => {
    expect(PUBLIC_PATHS.has("/api/cron/daily")).toBe(true);
    expect(PUBLIC_PATHS.has("/api/i2v/progress")).toBe(true);
    expect(PUBLIC_PATHS.has("/api/youtube/websub")).toBe(true);
  });

  it("trang công khai Google cần để duyệt OAuth vẫn giữ", () => {
    for (const p of ["/about", "/privacy", "/login"]) expect(PUBLIC_PATHS.has(p)).toBe(true);
  });

  it("KHÔNG được hở trang có dữ liệu", () => {
    for (const p of ["/", "/videos", "/series", "/usage", "/settings/ai", "/api/flow/1", "/api/live"]) {
      expect(PUBLIC_PATHS.has(p), p).toBe(false);
    }
  });

  it("mỗi đường dẫn miễn đều phải tự kiểm quyền — danh sách đóng, thêm là phải sửa test này", () => {
    expect([...PUBLIC_PATHS].sort()).toEqual(
      ["/about", "/api/cron/daily", "/api/i2v/progress", "/api/youtube/websub", "/login", "/privacy"].sort(),
    );
  });
});
