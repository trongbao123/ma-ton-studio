/** Kiểu dữ liệu của kênh lịch sử — tách riêng để schema DB import được mà không kéo theo prompt. */

/** Loại nguồn: bách khoa (Wikipedia), sử liệu gốc (Wikisource), trang web tin cậy (qua tìm kiếm). */
export type DossierSourceKind = "wikipedia" | "wikisource" | "web";
/** Một nguồn tư liệu trong hồ sơ của đề tài. */
export type DossierSource = { kind: DossierSourceKind; lang: "vi" | "en"; title: string; url: string; text: string };

/** Hồ sơ tư liệu gom trước khi viết: kịch bản, lượt soát và mô tả video cùng dùng. */
export type Dossier = { topic: string; sources: DossierSource[]; fetchedAt: string };

/** Một khẳng định trong kịch bản không được hồ sơ ủng hộ (hoặc mâu thuẫn), kèm câu sửa đề xuất. */
export type FactIssue = { quote: string; verdict: "khong-co" | "mau-thuan"; note: string; fix: string };
