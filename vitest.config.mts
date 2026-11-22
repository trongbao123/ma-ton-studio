import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts", "pipeline/**/*.test.ts"],
    // 5 giây mặc định là quá sát: chạy cả bộ, vitest mở 94 worker song song nên test đọc file/đo giờ
    // (scene-terrain, geo-base) có lần quá hạn rồi đỏ oan dù chạy riêng chỉ hơn 1 giây.
    testTimeout: 20_000,
  },
});
