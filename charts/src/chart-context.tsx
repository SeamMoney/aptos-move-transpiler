"use client";

import type { ScaleLinear, ScaleTime } from "d3-scale";
import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { ChartMargin, ChartSelection } from "./types";
import { cssVars } from "./css-vars";

export { cssVars as chartCssVars };

export interface ChartContextValue {
  /** Full data array */
  data: Record<string, unknown>[];
  /** Time scale for x-axis */
  xScale: ScaleTime<number, number>;
  /** Linear scale for y-axis (price) */
  yScale: ScaleLinear<number, number>;
  /** Optional secondary y-scale (volume) */
  yScaleSecondary?: ScaleLinear<number, number>;
  /** Chart inner dimensions (after margins) */
  innerWidth: number;
  innerHeight: number;
  /** Full chart dimensions */
  width: number;
  height: number;
  /** Margin configuration */
  margin: ChartMargin;
  /** Key to access x (date) values */
  xDataKey: string;
  /** Currently hovered data index */
  hoveredIndex: number | null;
  /** Current selection range */
  selection: ChartSelection | null;
  /** Whether the chart is currently animating in */
  isAnimating: boolean;
}

const ChartContext = createContext<ChartContextValue | null>(null);

export function ChartProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ChartContextValue;
}) {
  return (
    <ChartContext.Provider value={value}>{children}</ChartContext.Provider>
  );
}

export function useChart(): ChartContextValue {
  const ctx = useContext(ChartContext);
  if (!ctx) {
    throw new Error(
      "useChart must be used within a ChartProvider. " +
        "Wrap your component in <CandlestickChart> or <TickerLineChart>."
    );
  }
  return ctx;
}
