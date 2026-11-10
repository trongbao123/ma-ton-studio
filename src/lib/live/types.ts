import type { SourceDay, SourceId } from "@/lib/ai/sources";
import type { FlowData } from "@/lib/flow/model";

/** Số liệu một video YouTube tại thời điểm `at` (ms epoch). Ẩn like/comment thì về 0. */
export type YtStat = { views: number; likes: number; comments: number; at: number };
export type YtStatsMap = Record<string, YtStat>;
export type ChannelStat = { views: number; subscribers: number | null; videos: number; at: number };
/** metaAt: lần cuối tiêu đề/mô tả/thumbnail/lịch đăng đồng bộ từ YouTube làm đổi DB (ms) — trang danh sách thấy tăng thì tự làm mới. */
export type LiveStats = { videos: YtStatsMap; channel: ChannelStat | null; metaAt?: number | null };

/** Video đang render + tiến độ gọn cho thanh trên cùng. */
export type RenderingNow = { id: number; number: number; pct: number | null; live: string | null; updatedAt: string };

export type LiveStatus = {
  rendering: RenderingNow | null;
  queued: number;
  today: Partial<Record<SourceId, SourceDay>>;
  /** Gói CLI đã gọi thử thành công (job ai-check ghi). */
  cliOk: { claude: boolean; chatgpt: boolean };
};

/** Sự kiện SSE: `status`, `flow` (kèm ?video=), `stats` (mỗi ~60 giây). */
export type LiveEvents = { status: LiveStatus; flow: FlowData; stats: LiveStats };
export type LiveEventName = keyof LiveEvents;
