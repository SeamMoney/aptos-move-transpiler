"use client";

import { GridColumns, GridRows } from "@visx/grid";
import type { ScaleLinear, ScaleTime } from "d3-scale";
import { useId } from "react";
import { cssVars } from "./css-vars";

interface ChartGridProps {
  width: number;
  height: number;
  xScale: ScaleTime<number, number>;
  yScale: ScaleLinear<number, number>;
  showRows?: boolean;
  showColumns?: boolean;
  stroke?: string;
  strokeOpacity?: number;
  strokeWidth?: number;
  strokeDasharray?: string;
  numTicksRows?: number;
  numTicksColumns?: number;
  fadeEdges?: boolean;
}

export function ChartGrid({
  width,
  height,
  xScale,
  yScale,
  showRows = true,
  showColumns = false,
  stroke = cssVars.grid,
  strokeOpacity = 1,
  strokeWidth = 1,
  strokeDasharray,
  numTicksRows = 5,
  numTicksColumns = 6,
  fadeEdges = true,
}: ChartGridProps) {
  const maskId = useId();

  return (
    <g>
      {fadeEdges && (
        <defs>
          <linearGradient id={`grid-fade-h-${maskId}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity={0} />
            <stop offset="10%" stopColor="white" stopOpacity={1} />
            <stop offset="90%" stopColor="white" stopOpacity={1} />
            <stop offset="100%" stopColor="white" stopOpacity={0} />
          </linearGradient>
          <mask id={`grid-mask-${maskId}`}>
            <rect
              fill={`url(#grid-fade-h-${maskId})`}
              height={height}
              width={width}
              x={0}
              y={0}
            />
          </mask>
        </defs>
      )}

      <g mask={fadeEdges ? `url(#grid-mask-${maskId})` : undefined}>
        {showRows && (
          <GridRows
            height={height}
            numTicks={numTicksRows}
            scale={yScale}
            stroke={stroke}
            strokeDasharray={strokeDasharray}
            strokeOpacity={strokeOpacity}
            strokeWidth={strokeWidth}
            width={width}
          />
        )}
        {showColumns && (
          <GridColumns
            height={height}
            numTicks={numTicksColumns}
            scale={xScale}
            stroke={stroke}
            strokeDasharray={strokeDasharray}
            strokeOpacity={strokeOpacity}
            strokeWidth={strokeWidth}
            width={width}
          />
        )}
      </g>
    </g>
  );
}
