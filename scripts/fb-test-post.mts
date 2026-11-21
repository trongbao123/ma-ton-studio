// Đăng thử lên Page Facebook của một kênh (cần DATABASE_URL + SECRETS_KEY — chạy trên Actions hoặc máy có đủ env).
// pnpm exec tsx scripts/fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"
// pnpm exec tsx scripts/fb-test-post.mts <kênh> video <file.mp4> "<tiêu đề>" "<mô tả>"
import { duration } from "../pipeline/ffmpeg";
import { pageAccessToken, publishPageVideoAs, publishReelAs } from "@/lib/facebook";
import { loadSecrets } from "@/lib/secrets";
import { isChannelKey } from "@/lib/youtube";

const [ch, mode, file, text = "", description = ""] = process.argv.slice(2);
if (!ch || !isChannelKey(ch) || !file || (mode !== "reel" && mode !== "video")) {
  console.error('Dùng: fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"  |  <kênh> video <file.mp4> "<tiêu đề>" "<mô tả>"');
  process.exit(1);
}
await loadSecrets(true);
const page = await pageAccessToken(ch);
if (mode === "reel") {
  const { videoId } = await publishReelAs(page, file, { description: text, seconds: await duration(file) });
  console.log(`Đã đăng Reel ${videoId} — https://www.facebook.com/reel/${videoId}`);
} else {
  const { videoId } = await publishPageVideoAs(page, file, { title: text, description });
  console.log(`Đã đăng video ${videoId} — https://www.facebook.com/${page.pageId}/videos/${videoId}`);
}
