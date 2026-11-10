"use client";

import { getSmoothStepPath, type Edge, type EdgeProps } from "@xyflow/react";
import type { EdgeTone } from "@/lib/flow/edges";

export type FlowEdgeData = { tone: EdgeTone };

const STROKE: Record<EdgeTone, string> = { run: "#38bdf8", done: "#2f7d4f", error: "#7f1d1d", quota: "#b45309", idle: "#34343e" };

/**
 * Dây chính của cây (đi dọc, smoothstep). Đang chạy: nền sáng + chấm sáng chảy dọc dây (CSS, tự tắt khi prefers-reduced-motion);
 * xong: xanh tĩnh; chưa tới: xám mờ. Đổi màu có chuyển sắc để không giật.
 */
export function FlowEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<FlowEdgeData>>) {
  const tone = data?.tone ?? "idle";
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 18 });
  return (
    <g>
      <path d={path} fill="none" strokeWidth={3} strokeLinecap="round" opacity={tone === "idle" ? 0.6 : 1} style={{ stroke: STROKE[tone], transition: "stroke .5s ease, opacity .5s ease" }} />
      {tone === "run" && (
        <>
          <path d={path} fill="none" className="edge-glow" />
          <path d={path} fill="none" className="edge-flow" />
        </>
      )}
    </g>
  );
}

export const edgeTypes = { flow: FlowEdge };
