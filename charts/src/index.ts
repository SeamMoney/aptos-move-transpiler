// ─── Chart Components ───────────────────────────────────────────────────────
export { CandlestickChart } from "./candlestick-chart";
export type { CandlestickChartProps } from "./candlestick-chart";

export { TickerLineChart } from "./ticker-line-chart";
export type { TickerLineChartHandle, TickerLineChartProps } from "./ticker-line-chart";

export { Liveline } from "./liveline";
export type {
  LivelineHandle,
  LivelineProps,
  LivelinePoint,
  LivelinePalette,
  Momentum,
  ThemeMode,
  DegenOptions,
} from "./liveline";

// ─── Supporting Components ──────────────────────────────────────────────────
export { ChartGrid } from "./chart-grid";
export { ChartTooltip, Crosshair, PriceLine, TooltipDot } from "./chart-tooltip";
export { CurrentPriceLabel, PriceAxis, TimeAxis } from "./price-axis";
export { VolumeBars } from "./volume-bars";

// ─── Context & Hooks ────────────────────────────────────────────────────────
export { ChartProvider, useChart, chartCssVars } from "./chart-context";
export { useAnimationFrame, lerp, springInterpolate } from "./use-animation-frame";

// ─── Data Generators ────────────────────────────────────────────────────────
export { generateOHLCData, generateTickerData, createPriceStream } from "./data-generators";

// ─── LiveCandle (combined canvas engine) ────────────────────────────────────
export { LiveCandle } from "./live-candle";
export type {
  LiveCandleHandle,
  LiveCandleProps,
  OHLCPoint as LiveCandleOHLC,
  TickPoint as LiveCandleTick,
  CandleStyle,
  CandleBodyStyle,
  CandleWickStyle,
  CandleLiveStyle,
  CandleHoverStyle,
  VolumeStyle,
  HoverData,
  WindowOption,
  ReferenceLine as LiveCandleReferenceLine,
  CandleHollowMode,
  WickColorMode,
} from "./live-candle";
export {
  resolvePalette,
  lcDarkThemeVars,
  lcLightThemeVars,
  resolveCandleStyle,
  resolveVolumeStyle,
} from "./live-candle";

// ─── Theming ────────────────────────────────────────────────────────────────
export { cssVars, darkThemeVars, lightThemeVars } from "./css-vars";

// ─── Types ──────────────────────────────────────────────────────────────────
export type {
  OHLCDataPoint,
  TickerDataPoint,
  PriceDirection,
  CandleInterval,
  ChartMargin,
  TooltipRow,
  ChartSelection,
  StreamConfig,
  CandlestickStyle,
} from "./types";
