// In số liệu YouTube (view, like, bình luận) mọi video dài + Short của một kênh — để biết hỏng ở CTR hay giữ chân.
// CLI: render.ts "stats:<kênh>" (vd stats:chuyen-doi). Chỉ đọc, không sửa gì.
import { eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { chapters, series, videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { accessToken, getYoutubeAuth } from "@/lib/youtube";

export async function printStats(channel: string) {
  await loadSecrets(true);
  const auth = await getYoutubeAuth(channel);
  if (!auth) throw new Error(`Chưa kết nối YouTube kênh ${channel}.`);
  const token = await accessToken(auth.refreshToken);
  const rows = await db()
    .select({ id: videos.id, yt: videos.youtubeVideoId, short: videos.youtubeShortId, at: videos.publishAt, dur: videos.durationSec, title: chapters.title })
    .from(videos).innerJoin(chapters, eq(chapters.id, videos.chapterId)).innerJoin(series, eq(series.id, chapters.seriesId))
    .where(eq(series.channel, channel));
  const withYt = rows.filter((r) => r.yt || r.short);
  const ids = withYt.flatMap((r) => [r.yt, r.short].filter(Boolean) as string[]);
  const stats = new Map<string, { views: number; likes: number; comments: number; privacy: string; published: string }>();
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,status,snippet&id=${ids.slice(i, i + 50).join(",")}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as { items?: { id: string; statistics: Record<string, string>; status: { privacyStatus: string }; snippet: { publishedAt: string } }[] };
    for (const it of j.items ?? []) stats.set(it.id, { views: Number(it.statistics.viewCount ?? 0), likes: Number(it.statistics.likeCount ?? 0), comments: Number(it.statistics.commentCount ?? 0), privacy: it.status.privacyStatus, published: it.snippet.publishedAt });
  }
  const fmt = (id: string | null) => {
    if (!id) return "-";
    const s = stats.get(id);
    return s ? `${s.views} view/${s.likes} like/${s.comments} bl (${s.privacy})` : "không thấy (đã xoá?)";
  };
  for (const r of withYt.sort((a, b) => a.id - b.id))
    console.log(`#${r.id} ${Math.round((r.dur ?? 0) / 60)}p hẹn ${r.at?.toISOString().slice(0, 10)} | DÀI ${fmt(r.yt)} | SHORT ${fmt(r.short)} | ${r.title.slice(0, 60)}`);
}
