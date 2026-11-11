// Dẫn người xem từ các video cũ sang 1 tập mới: chèn link tập lên ĐẦU mô tả + đăng bình luận có link (ghim tay trong Studio —
// YouTube API không cho ghim). CLI: render.ts "promote:<videoId tập>:<id video cũ,…>".
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { accessToken, getYoutubeAuth, updateYoutubeSnippet } from "@/lib/youtube";
import { postComment } from "./comment";
import { recordYoutubeUnits } from "@/lib/yt-units";

const MARK = "▶ XEM TIẾP";

/** Bỏ dòng dẫn cũ (chạy lại không bị chồng) rồi chèn dòng mới lên đầu. Thuần — để test. */
export function withLeadLink(description: string, line: string) {
  const rest = description.split("\n").filter((l) => !l.startsWith(MARK)).join("\n").replace(/^\n+/, "");
  return `${line}\n\n${rest}`;
}

export async function promoteEpisode(episodeId: number, targetIds: number[]) {
  await loadSecrets(true);
  const [ep] = await db().select().from(videos).where(eq(videos.id, episodeId));
  if (!ep?.youtubeVideoId || !ep.meta) throw new Error(`Tập #${episodeId} chưa có trên YouTube.`);
  const mins = Math.round((ep.durationSec ?? 0) / 60);
  const label = ep.meta.compilation?.episodeNo ? `TẬP ${ep.meta.compilation.episodeNo}` : "TẬP MỚI";
  const url = `https://youtu.be/${ep.youtubeVideoId}`;
  const line = `${MARK} ${label} (FULL ${Math.floor(mins / 60)}H${String(mins % 60).padStart(2, "0")}): ${url}`;
  const auth = await getYoutubeAuth();
  if (!auth) throw new Error("Chưa kết nối YouTube.");
  const token = await accessToken(auth.refreshToken);
  for (const v of await db().select().from(videos).where(inArray(videos.id, targetIds))) {
    if (!v.youtubeVideoId || !v.meta) continue;
    const description = withLeadLink(v.meta.description, line);
    await updateYoutubeSnippet(v.youtubeVideoId, { title: v.meta.title, description, tags: v.meta.tags });
    await recordYoutubeUnits("videoUpdate");
    await db().update(videos).set({ meta: { ...v.meta, description } }).where(eq(videos.id, v.id));
    const err = await postComment(
      token,
      v.youtubeVideoId,
      `🔥 Nghe tiếp ${label} — trọn ${mins} phút liền mạch: ${url}\nĐăng ký kênh để không lỡ tập mới mỗi ngày lúc 15h!`,
    );
    console.log(`  #${v.id} youtu.be/${v.youtubeVideoId}: mô tả ✔, bình luận ${err ? `✗ ${err}` : "✔"}`);
  }
}
