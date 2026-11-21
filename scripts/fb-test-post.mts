// Đăng thử lên Page Facebook của một kênh (cần DATABASE_URL + SECRETS_KEY — chạy trên Actions hoặc máy có đủ env).
// pnpm exec tsx scripts/fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"
// pnpm exec tsx scripts/fb-test-post.mts <kênh> video <file.mp4> "<tiêu đề>" "<mô tả>"
// pnpm exec tsx scripts/fb-test-post.mts <kênh> delete <id1,id2,…>
import { duration } from "../pipeline/ffmpeg";
import { deletePageObjectAs, pageAccessToken, publishPageVideoAs, publishReelAs } from "@/lib/facebook";
import { loadSecrets } from "@/lib/secrets";
import { isChannelKey } from "@/lib/youtube";

const [ch, mode, file, text = "", description = ""] = process.argv.slice(2);
// FB_DRAFT=1 → tải lên dạng nháp, chủ kênh tự bấm đăng trên Meta Business Suite.
const draft = process.env.FB_DRAFT === "1";
if (!ch || !isChannelKey(ch) || !file || !["reel", "video", "delete"].includes(mode)) {
  console.error('Dùng: fb-test-post.mts <kênh> reel <file.mp4> "<mô tả>"  |  <kênh> video <file.mp4> "<tiêu đề>" "<mô tả>"');
  process.exit(1);
}
await loadSecrets(true);
const page = await pageAccessToken(ch);
if (mode === "delete") {
  for (const id of file.split(",").map((x) => x.trim()).filter(Boolean)) {
    await deletePageObjectAs(page, id).then(
      () => console.log(`Đã xoá ${id}`),
      (e: unknown) => console.log(`Không xoá được ${id}: ${e instanceof Error ? e.message : e}`),
    );
  }
} else if (mode === "reel") {
  const { videoId } = await publishReelAs(page, file, { description: text, seconds: await duration(file), draft });
  console.log(`${draft ? "Đã tải nháp" : "Đã đăng"} Reel ${videoId} — https://www.facebook.com/reel/${videoId}`);
} else {
  const { videoId } = await publishPageVideoAs(page, file, { title: text, description, draft });
  console.log(`${draft ? "Đã tải nháp" : "Đã đăng"} video ${videoId} — https://www.facebook.com/${page.pageId}/videos/${videoId}`);
}
