/** OHLCV candlestick data point */
export interface OHLCDataPoint {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Streaming ticker data point */
export interface TickerDataPoint {
  date: Date;
  price: number;
  volume?: number;
}

/** Price change direction */
export type PriceDirection = "up" | "down" | "neutral";

/** Time interval for candlesticks */
export type CandleInterval =
  | "1s"
  | "5s"
  | "15s"
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d";

/** Chart margin configuration */
export interface ChartMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Tooltip row for displaying values */
export interface TooltipRow {
  color: string;
  label: string;
  value: number | string;
}

/** Selection range on the chart */
export interface ChartSelection {
  startIndex: number;
  endIndex: number;
}

/** Configuration for real-time data streaming */
export interface StreamConfig {
  /** Target frames per second for animation updates */
  fps?: number;
  /** Maximum data points to keep in memory */
  maxPoints?: number;
  /** Smoothing factor for price interpolation (0-1) */
  smoothing?: number;
  /** Enable spring physics for price transitions */
  springPhysics?: boolean;
}

/** Candlestick visual configuration */
export interface CandlestickStyle {
  /** Width of the candle body as ratio of available space (0-1) */
  bodyWidthRatio?: number;
  /** Width of the wick/shadow line */
  wickWidth?: number;
  /** Border radius on candle body */
  bodyRadius?: number;
  /** Gap between candles in pixels */
  gap?: number;
}
