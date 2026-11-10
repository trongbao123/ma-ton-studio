import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videos } from "@/db/schema";
import { loadFlowData } from "@/lib/flow/data";
import { diffEvents, formatSse } from "@/lib/live/events";
import type { LiveEventName, LiveStats, LiveStatus } from "@/lib/live/types";
import { liveStatus } from "@/lib/usage-data";
import { loadLiveStats, readStatsSnapshot } from "@/lib/youtube-stats";

// Hobby + fluid compute cho tối đa 300s. Tự đóng trước mốc đó để client nối lại sạch (không bị Vercel cắt giữa chừng).
export const maxDuration = 300;
const CLOSE_AFTER_MS = 270_000;
/** Có việc đang chạy thì đọc DB mỗi 3s; rảnh thì thưa ra để Neon còn ngủ được giữa các lần tab mở. */
const TICK_ACTIVE_MS = 3_000;
const TICK_IDLE_MS = 9_000;
const HEARTBEAT_MS = 15_000;
const STATS_EVERY_MS = 60_000;
const CLIENT_RETRY_MS = 3_000;

const encoder = new TextEncoder();

const warn = (part: string, e: unknown) => console.warn(`SSE /api/live lỗi (${part}):`, e instanceof Error ? e.message : e);

/** Ngủ `ms` nhưng thoát ngay khi client ngắt. */
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/** Truy vấn dò 1 dòng: chỉ khi dấu vân tay đổi mới nạp cả dữ liệu flow (nhiều truy vấn). pipeline ghi updatedAt cả khi cập nhật tiến độ lẫn nhịp tim. */
async function probeVideo(id: number) {
  const [row] = await db()
    .select({ status: videos.status, uploadStatus: videos.uploadStatus, updatedAt: videos.updatedAt, longId: videos.youtubeVideoId, shortId: videos.youtubeShortId })
    .from(videos)
    .where(eq(videos.id, id));
  if (!row) return null;
  const ids = [row.longId, row.shortId].filter((x): x is string => Boolean(x));
  return { fingerprint: `${row.status}|${row.uploadStatus}|${row.updatedAt.getTime()}`, busy: row.uploadStatus === "uploading", ids };
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("video");
  const videoId = raw === null ? null : Number(raw);
  if (videoId !== null && (!Number.isSafeInteger(videoId) || videoId <= 0)) return new Response("Sai id", { status: 400 });

  const { signal } = request;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      let sent: Partial<Record<LiveEventName, string>> = {};
      const emit = (next: Partial<{ [K in LiveEventName]: unknown }>) => {
        const { changed, state } = diffEvents(sent, next);
        sent = state;
        for (const c of changed) write(formatSse(c.event, c.json));
        return changed.length > 0;
      };

      let lastWrite = Date.now();
      let nextStatsAt = 0;
      let flowFingerprint = "";
      write(`retry: ${CLIENT_RETRY_MS}\n\n`);

      // Số đã lưu gửi ngay để trang có số tức thì, không chờ gọi YouTube.
      emit({ stats: await readStatsSnapshot() });

      while (open && !signal.aborted && Date.now() - startedAt < CLOSE_AFTER_MS) {
        let busy = false;
        // Mỗi phần có try riêng: flow lỗi (hoặc YouTube lỗi) không được làm mất sự kiện status.
        let probe: Awaited<ReturnType<typeof probeVideo>> = null;
        if (videoId !== null) {
          try {
            probe = await probeVideo(videoId);
            if (probe && probe.fingerprint !== flowFingerprint) {
              // Đặt trước khi nạp: nạp lỗi thì đợi video đổi tiếp (nhịp tim pipeline ghi mỗi phút) chứ không nện DB mỗi 3s.
              flowFingerprint = probe.fingerprint;
              const flow = await loadFlowData(videoId);
              if (flow && emit({ flow })) lastWrite = Date.now();
            }
          } catch (e) {
            warn("flow", e);
          }
        }
        try {
          const status: LiveStatus = await liveStatus();
          busy = Boolean(status.rendering) || status.queued > 0 || Boolean(probe?.busy);
          if (emit({ status })) lastWrite = Date.now();
        } catch (e) {
          warn("status", e);
        }
        if (Date.now() >= nextStatsAt) {
          nextStatsAt = Date.now() + STATS_EVERY_MS;
          try {
            const stats: LiveStats = await loadLiveStats(probe?.ids ?? []);
            if (emit({ stats })) lastWrite = Date.now();
          } catch (e) {
            warn("stats", e);
          }
        }
        if (Date.now() - lastWrite >= HEARTBEAT_MS) {
          write(": ping\n\n");
          lastWrite = Date.now();
        }
        await sleep(busy ? TICK_ACTIVE_MS : TICK_IDLE_MS, signal);
      }

      // Báo trước rồi đóng: client nối lại ngay, không tính là lỗi.
      write(formatSse("bye", "{}"));
      if (open) {
        try {
          controller.close();
        } catch {
          /* client đã ngắt */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
