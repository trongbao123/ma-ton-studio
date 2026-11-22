// Cảnh tranh tư liệu: tìm tranh/bản khắc cổ trên Wikimedia Commons (giấy phép tự do, đúng đề tài), lia máy chậm,
// tông giấy cũ. Không có tranh hợp thì bên gọi cho AI vẽ và đóng nhãn "Minh họa".
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Shot } from "@/lib/story/storyboard";
import { WIKI_USER_AGENT } from "@/lib/story/wiki-api";
import { ffmpeg } from "./ffmpeg";

export const ART_W = 1920;
export const ART_H = 1080;
export const ART_FPS = 25;

/** Ảnh dùng cho một cảnh; `synthetic` = AI vẽ, phải đóng nhãn "Minh họa". */
export type ArtImage = { file: string; title: string; url: string; license: string; artist: string; synthetic: boolean };

/** Ảnh hẹp hơn ngần này vỡ hình khi phóng lên 1080p. */
const MIN_ART_WIDTH = 900;
/** Chủ kênh: "video tao gửi đâu cần ảnh hiện vật" — loại ảnh chụp hiện đại, tượng đài, trong bảo tàng. */
const MODERN_PHOTO = /statue|tượng|monument|đài tưởng niệm|temple|đền thờ|lăng|museum|bảo tàng|IMG[_\s]?\d|DSC[_\s]?\d|\d{8}_\d{6}/i;
/** Chỉ nhận giấy phép tự do (PD, CC0, CC BY, CC BY-SA) — NC/ND không dùng được cho kênh kiếm tiền. */
const FREE_LICENSE = /public domain|^pd(-|$)|cc0|cc[- ]by(-sa)?[- ]?\d/i;
const RESTRICTED_LICENSE = /\bnc\b|\bnd\b|non[- ]commercial|no derivative|fair use/i;
const SEARCH_LIMIT = "12";
/** Ảnh tải về nhỏ hơn ngần này là trang lỗi, không phải ảnh. */
const MIN_ART_BYTES = 10_000;

export type ArtCandidate = { title: string; license: string; width: number };

/** Ảnh dùng được: không phải ảnh chụp hiện đại, đúng đề tài, giấy phép tự do, đủ to. */
export function isUsableArtwork(candidate: ArtCandidate, topicTerms: string[]): boolean {
  if (MODERN_PHOTO.test(candidate.title)) return false;
  if (!FREE_LICENSE.test(candidate.license) || RESTRICTED_LICENSE.test(candidate.license)) return false;
  if (candidate.width < MIN_ART_WIDTH) return false;
  const title = candidate.title.toLowerCase();
  return topicTerms.some((term) => title.includes(term.toLowerCase()));
}

type CommonsPage = {
  title: string;
  imageinfo?: { thumburl?: string; width: number; extmetadata?: Record<string, { value: string }> }[];
};

export type ArtworkRequest = { query: string; topicTerms: string[]; dir: string; want: number };

/** Tìm và tải tối đa `want` tranh tư liệu đúng đề tài; không có tranh nào hợp → mảng rỗng. */
export async function pickArtwork({ query, topicTerms, dir, want }: ArtworkRequest): Promise<ArtImage[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrsearch: `${query} filetype:bitmap`, gsrnamespace: "6", gsrlimit: SEARCH_LIMIT,
    prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: String(ART_W),
  });
  const found = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": WIKI_USER_AGENT } })
    .then(async (res) => (res.ok ? ((await res.json()) as { query?: { pages?: Record<string, CommonsPage> } }) : null))
    .catch((e: unknown) => {
      console.warn(`⚠ Tìm tranh "${query}" lỗi:`, e instanceof Error ? e.message : e);
      return null;
    });
  const picked: ArtImage[] = [];
  for (const candidate of Object.values(found?.query?.pages ?? {})) {
    if (picked.length >= want) break;
    const info = candidate.imageinfo?.[0];
    const license = info?.extmetadata?.LicenseShortName?.value ?? "";
    if (!info?.thumburl || !isUsableArtwork({ title: candidate.title, license, width: info.width }, topicTerms)) continue;
    const file = path.join(dir, `art-${picked.length}.jpg`);
    const data = await fetch(info.thumburl, { headers: { "User-Agent": WIKI_USER_AGENT } })
      .then(async (res) => (res.ok ? Buffer.from(await res.arrayBuffer()) : null))
      .catch(() => null);
    if (!data || data.length < MIN_ART_BYTES) continue;
    await writeFile(file, data);
    picked.push({
      file,
      title: candidate.title,
      url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(candidate.title.replace(/ /g, "_"))}`,
      license,
      artist: (info.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim(),
      synthetic: false,
    });
  }
  return picked;
}

/** Dòng ghi công cho mô tả video (bắt buộc với CC BY / CC BY-SA). */
export function artCredits(images: ArtImage[]): string {
  const real = images.filter((a) => !a.synthetic);
  const lines = real.map((a) => `- ${a.title} — ${a.artist || "không rõ tác giả"} — ${a.license} — ${a.url}`);
  const note = images.some((a) => a.synthetic) ? "\nCác khung có chữ “Minh họa” là tranh do AI vẽ, không phải ảnh tư liệu." : "";
  return `${lines.length ? `Tranh/ảnh tư liệu (Wikimedia Commons):\n${lines.join("\n")}` : ""}${note}`.trim();
}

const SEPIA = "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,eq=contrast=1.08:brightness=-0.03";
const GRAIN = "noise=alls=5:allf=t,vignette=PI/4.5";
const FONT = path.resolve("pipeline/fonts/BeVietnamPro-Bold.ttf");
const filterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:");

/** Đường đi của máy quay trong cảnh tranh: đứng yên, đẩy nhẹ, hoặc lia ngang. */
function cameraMove(camera: Shot["camera"], frames: number) {
  if (camera === "hold") return `zoompan=z=1.02:x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${ART_W}x${ART_H}:fps=${ART_FPS}`;
  if (camera === "push") return `zoompan=z='1.03+0.09*on/${frames}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=${frames}:s=${ART_W}x${ART_H}:fps=${ART_FPS}`;
  return `zoompan=z=1.12:x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)/2':d=${frames}:s=${ART_W}x${ART_H}:fps=${ART_FPS}`;
}

export type ArtScene = { shot: Shot; art: ArtImage; out: string };

/** Dựng cảnh tranh: tranh trên nền mờ của chính nó, máy quay chậm, tông giấy cũ; ảnh AI có nhãn "Minh họa". */
export async function renderArtScene({ shot, art, out }: ArtScene) {
  const seconds = Math.max(0.5, shot.end - shot.start);
  const frames = Math.round(seconds * ART_FPS);
  const label = art.synthetic
    ? `,drawtext=fontfile='${filterPath(FONT)}':text='Minh họa':fontsize=30:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=12:x=w-tw-40:y=40`
    : "";
  const graph = [
    "[0:v]split[bg][fg]",
    `[bg]scale=${ART_W}:${ART_H}:force_original_aspect_ratio=increase,crop=${ART_W}:${ART_H},boxblur=30:3,eq=brightness=-0.12[blur]`,
    `[fg]scale=${ART_W}:${ART_H}:force_original_aspect_ratio=decrease[sharp]`,
    `[blur][sharp]overlay=(W-w)/2:(H-h)/2,scale=${ART_W * 2}:${ART_H * 2},${cameraMove(shot.camera, frames)},${SEPIA},${GRAIN}${label},format=yuv420p[v]`,
  ].join(";");
  await ffmpeg(["-loop", "1", "-i", art.file, "-filter_complex", graph, "-map", "[v]", "-t", String(seconds), "-r", String(ART_FPS), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out]);
}
