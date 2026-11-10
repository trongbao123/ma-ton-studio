"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { FlowData } from "@/lib/flow/model";
import { backoffMs } from "./events";
import type { LiveStats, LiveStatus } from "./types";

/**
 * Một EventSource duy nhất cho cả trang (singleton module, mọi component dùng chung qua useLive).
 * - idle: chưa nối / tab đang ẩn · connecting: đang nối · open: đã nhận dữ liệu · retry: vừa lỗi, đang chờ nối lại
 * - fallback: lỗi liên tục (hoặc trình duyệt không có EventSource) → nơi cần dữ liệu tự quay về polling.
 */
export type LiveConn = "idle" | "connecting" | "open" | "retry" | "fallback";
export type LiveState = { conn: LiveConn; status: LiveStatus | null; flow: FlowData | null; stats: LiveStats | null };

/** Lỗi liên tiếp (chưa nhận được gì) bao nhiêu lần thì coi là SSE hỏng và cho polling dự phòng chạy. */
const FALLBACK_AFTER = 3;
/** Sau khi server đóng chủ động (hết maxDuration) nối lại gần như ngay. */
const REOPEN_MS = 400;
/** Gom các lần đổi video quan tâm liên tiếp (chuyển trang) thành một lần nối lại. */
const REVIEW_MS = 150;

let state: LiveState = { conn: "idle", status: null, flow: null, stats: null };
const listeners = new Set<() => void>();
const watchedVideos: number[] = [];
let source: EventSource | null = null;
let failures = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let visibilityBound = false;

function set(patch: Partial<LiveState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const currentVideo = () => watchedVideos.at(-1) ?? null;

function close() {
  clearTimeout(timer);
  source?.close();
  source = null;
}

function schedule(ms: number) {
  clearTimeout(timer);
  timer = setTimeout(connect, ms);
}

function connect() {
  close();
  if (!listeners.size) return set({ conn: "idle" });
  if (typeof EventSource === "undefined") return set({ conn: "fallback" });
  // Tab ẩn thì không giữ kết nối (đỡ tốn Neon / quota YouTube); hiện lại sẽ nối tiếp.
  if (document.visibilityState === "hidden") return set({ conn: "idle" });
  if (state.conn !== "retry" && state.conn !== "fallback") set({ conn: "connecting" });

  const video = currentVideo();
  const src = new EventSource(video ? `/api/live?video=${video}` : "/api/live");
  source = src;
  let received = false;

  const onData = <T,>(apply: (data: T) => Partial<LiveState>) => (e: MessageEvent<string>) => {
    received = true;
    failures = 0;
    try {
      set({ conn: "open", ...apply(JSON.parse(e.data) as T) });
    } catch {
      /* khung hỏng: bỏ qua, khung sau sẽ sửa */
    }
  };
  src.addEventListener("status", onData<LiveStatus>((status) => ({ status })));
  src.addEventListener("flow", onData<FlowData>((flow) => ({ flow })));
  src.addEventListener("stats", onData<LiveStats>((stats) => ({ stats })));
  src.onerror = () => {
    // EventSource gặp lỗi HTTP (vd 401) là tự đóng hẳn; ta tự nối lại, kể cả khi server chủ động đóng (event bye).
    src.close();
    if (source === src) source = null;
    if (received) return schedule(REOPEN_MS);
    failures += 1;
    set({ conn: failures >= FALLBACK_AFTER ? "fallback" : "retry" });
    schedule(backoffMs(failures));
  };
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    if (!source) connect();
  } else {
    close();
    set({ conn: "idle" });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!visibilityBound) {
    visibilityBound = true;
    document.addEventListener("visibilitychange", onVisibility);
  }
  if (listeners.size === 1) {
    failures = 0;
    connect();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      close();
      set({ conn: "idle" });
    }
  };
}

const getSnapshot = () => state;
const serverSnapshot: LiveState = { conn: "idle", status: null, flow: null, stats: null };

/** Dữ liệu realtime dùng chung (trạng thái, flow của video đang xem, số liệu YouTube). Chưa có dữ liệu thì null — dùng giá trị server render. */
export function useLive(): LiveState {
  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

/** Đăng ký xem flow của một video: server kèm `flow` vào luồng SSE thay cho polling. */
export function useLiveVideo(id: number | null) {
  useEffect(() => {
    if (id === null) return;
    watchedVideos.push(id);
    // Bỏ flow của video khác để màn mới không nhận nhầm dữ liệu cũ.
    if (state.flow && state.flow.video.id !== id) set({ flow: null });
    if (listeners.size) schedule(REVIEW_MS);
    return () => {
      const i = watchedVideos.lastIndexOf(id);
      if (i >= 0) watchedVideos.splice(i, 1);
      if (listeners.size) schedule(REVIEW_MS);
    };
  }, [id]);
}
