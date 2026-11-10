// Danh sách phát YouTube cho mỗi bộ truyện: tự tạo lần đầu, mỗi video chương đăng xong tự vào đúng thứ tự chương.
// Lưu id playlist ở app_settings "yt_playlists" ({ [seriesId]: playlistId }) — không cần migration.
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, chapters, series, videos } from "@/db/schema";
import { loadSecrets } from "@/lib/secrets";
import { accessToken, getYoutubeAuth, noAngle } from "@/lib/youtube";

const KEY = "yt_playlists";
const API = "https://www.googleapis.com/youtube/v3";

async function token() {
  const auth = await getYoutubeAuth();
  if (!auth) throw new Error("Chưa kết nối YouTube.");
  return accessToken(auth.refreshToken);
}

/** POST YouTube API; 409/5xx (playlist vừa tạo, gọi dồn dập) thì thử lại có giãn cách. */
async function yt(path: string, tok: string, body: unknown) {
  let last = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    last = `${res.status}: ${(await res.text()).replace(/\s+/g, " ").slice(0, 300)}`;
    if (res.status !== 409 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
  }
  throw new Error(`YouTube ${path.split("?")[0]} ${last}`);
}

/** Id các video đã có trong playlist (tránh thêm trùng khi chạy lại). */
async function playlistVideoIds(playlistId: string, tok: string) {
  const res = await fetch(`${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlistId}`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) return new Set<string>();
  const j = (await res.json()) as { items?: { contentDetails?: { videoId?: string } }[] };
  return new Set((j.items ?? []).map((i) => i.contentDetails?.videoId).filter(Boolean) as string[]);
}

async function savedIds(): Promise<Record<string, string>> {
  const [row] = await db().select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, KEY));
  return (row?.value as Record<string, string>) ?? {};
}

export const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;

/** Id playlist đã có của bộ truyện (không tạo mới) — dùng để chèn link vào mô tả. */
export async function seriesPlaylist(seriesId: number) {
  return (await savedIds().catch(() => ({}) as Record<string, string>))[String(seriesId)] ?? null;
}

/** Lấy hoặc tạo playlist công khai cho bộ truyện. */
export async function ensurePlaylist(seriesId: number, tok?: string) {
  const ids = await savedIds();
  if (ids[String(seriesId)]) return ids[String(seriesId)];
  const [s] = await db().select().from(series).where(eq(series.id, seriesId));
  const t = tok ?? (await token());
  const res = await yt("playlists?part=snippet,status", t, {
    snippet: {
      title: noAngle(`${s.title} | Truyện Audio Tu Tiên Trọn Bộ`).slice(0, 150),
      description: noAngle(`Nghe trọn bộ ${s.title} theo thứ tự chương. ${s.premise}`).slice(0, 5000),
      defaultLanguage: "vi",
    },
    status: { privacyStatus: "public" },
  });
  const next = { ...ids, [String(seriesId)]: res.id as string };
  await db().insert(appSettings).values({ key: KEY, value: next }).onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  return res.id as string;
}

/** Thêm 1 video YouTube vào playlist của bộ truyện. Lỗi chỉ báo cho người gọi, không ảnh hưởng video. */
export async function addToSeriesPlaylist(seriesId: number, youtubeId: string) {
  const tok = await token();
  const playlistId = await ensurePlaylist(seriesId, tok);
  if ((await playlistVideoIds(playlistId, tok)).has(youtubeId)) return playlistId;
  await yt("playlistItems?part=snippet", tok, { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId: youtubeId } } });
  return playlistId;
}

/** Bù cho video đã đăng trước khi có tính năng này: thêm theo thứ tự chương (bỏ bản gộp). */
export async function backfillPlaylist(seriesId: number) {
  // Chạy riêng bằng CLI: key YouTube (client id/secret) lưu mã hoá trong DB → phải nạp trước.
  await loadSecrets(true);
  const rows = await db()
    .select({ ytId: videos.youtubeVideoId, number: chapters.number, meta: videos.meta })
    .from(videos)
    .innerJoin(chapters, eq(chapters.id, videos.chapterId))
    .where(and(eq(chapters.seriesId, seriesId), isNotNull(videos.youtubeVideoId)))
    .orderBy(asc(chapters.number));
  for (const r of rows.filter((x) => !x.meta?.compilation)) {
    const id = await addToSeriesPlaylist(seriesId, r.ytId!);
    console.log(`  + chương ${r.number} → ${playlistUrl(id)}`);
    await new Promise((res) => setTimeout(res, 2000));
  }
}
