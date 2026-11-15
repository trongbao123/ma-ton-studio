// Phần thuần của "3 thumbnail mỗi tập": id phương án, tên file, chọn phương án điểm vidIQ cao nhất.

export const THUMB_IDS = ["a", "b", "c"] as const;
export type ThumbId = (typeof THUMB_IDS)[number];
export type ThumbScores = Partial<Record<ThumbId, number | null>>;

/** Phương án mặc định khi không chấm được: (a) cận mặt + chữ. */
export const DEFAULT_THUMB: ThumbId = "a";

export const thumbFile = (id: ThumbId) => `thumb-${id}.jpg`;

/** Gợi ý khung hình riêng của từng phương án, nối sau prompt AI viết. */
export const THUMB_STYLE: Record<ThumbId, string> = {
  a: "extreme close-up of the main character's face filling 55% of the frame, screaming or killing-intent expression, glowing eyes, very high contrast, simple dark background, minimal detail",
  b: "dramatic face-off: the hero in the foreground facing a gigantic menacing monster or enemy, both faces readable, tense standoff, high contrast, simple background",
  c: "explosive burst of power: the hero unleashing a huge blast of spiritual energy and lightning, shockwave, light rays, intense expression, high contrast, saturated colors",
};

/**
 * Phương án có điểm cao nhất; hoà thì lấy phương án đứng trước (a trước). Không có điểm nào hợp lệ → (a).
 * Chỉ xét phương án có trong `available` (ảnh vẽ lỗi thì không chọn).
 */
export function pickBestThumb(scores: ThumbScores, available: readonly ThumbId[] = THUMB_IDS): ThumbId {
  let best: ThumbId | null = null;
  for (const id of THUMB_IDS) {
    const score = scores[id];
    if (!available.includes(id) || score == null || !Number.isFinite(score)) continue;
    if (best === null || score > (scores[best] as number)) best = id;
  }
  return best ?? DEFAULT_THUMB;
}
