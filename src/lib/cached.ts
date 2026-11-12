import { cacheLife, cacheTag } from "next/cache";
import { loadLimits } from "./limits-data";
import { SERIES_TAG, TRENDS_TAG, USAGE_HISTORY_TAG } from "./cache-tags";
import { seriesCards } from "./studio";
import { loadTrends } from "./trends";
import { usageByDay } from "./usage-data";

/**
 * Bản cache (Next "use cache") của dữ liệu ít đổi. Chỉ dùng trong trang / route của Next — pipeline (tsx) gọi thẳng hàm gốc.
 * Kết quả quét xu hướng do job GitHub Actions ghi thẳng DB nên không có hook để xoá cache → hết hạn theo thời gian (5 phút).
 */
export async function cachedTrends() {
  "use cache";
  cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
  cacheTag(TRENDS_TAG);
  return loadTrends();
}

/** Danh sách truyện + số chương: đổi khi duyệt / viết / tạo truyện (server action gọi updateTag(SERIES_TAG)). */
export async function cachedSeriesCards() {
  "use cache";
  cacheLife({ stale: 30, revalidate: 120, expire: 3600 });
  cacheTag(SERIES_TAG);
  return seriesCards();
}

/** Lượt dùng AI của các ngày quota ĐÃ QUA — không đổi nữa nên cache lâu. */
async function pastUsageByDay(days: string[]) {
  "use cache";
  cacheLife({ stale: 300, revalidate: 3600, expire: 86400 });
  cacheTag(USAGE_HISTORY_TAG);
  return usageByDay(days);
}

/** Lịch sử lượt dùng: ngày đầu (hôm nay) đọc trực tiếp, các ngày trước lấy từ cache; hai phần chạy song song. */
export async function usageHistory(days: string[]) {
  const [today, past] = await Promise.all([usageByDay(days.slice(0, 1)), pastUsageByDay(days.slice(1))]);
  return { ...today, ...past };
}

/**
 * Hạn mức các nguồn ngoài (Kaggle, GitHub, Cloudflare, vidIQ, gói Claude/ChatGPT…): hàng chục giây nếu một nguồn chậm.
 * Bản nhớ trong RAM của loadLimits mất mỗi lần Vercel khởi động instance mới; cache này dùng chung giữa các instance và
 * trả bản cũ ngay trong lúc làm mới nền, nên mở trang Hạn mức không phải chờ gọi API ngoài.
 */
export async function cachedLimits() {
  "use cache";
  cacheLife({ stale: 120, revalidate: 300, expire: 3600 });
  return loadLimits();
}
