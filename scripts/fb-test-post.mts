// Đăng thử lên Page Facebook của một kênh (cần DATABASE_URL + SECRETS_KEY — chạy trên Actions hoặc máy có đủ env).
// pnpm exec tsx scripts/fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"
import { duration } from "../pipeline/ffmpeg";
import { pageAccessToken, publishReelAs } from "@/lib/facebook";
import { loadSecrets } from "@/lib/secrets";
import { isChannelKey } from "@/lib/youtube";

const [ch, mode, file, ...rest] = process.argv.slice(2);
if (!ch || !isChannelKey(ch) || !file || mode !== "reel") {
  console.error('Dùng: fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"');
  process.exit(1);
}
await loadSecrets(true);
const page = await pageAccessToken(ch);
const { videoId } = await publishReelAs(page, file, { description: rest.join(" "), seconds: await duration(file) });
console.log(`Đã đăng Reel ${videoId} — https://www.facebook.com/reel/${videoId}`);
