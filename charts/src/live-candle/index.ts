// ─── Main Component ────────────────────────────────────────────────────────
export { LiveCandle } from "./LiveCandle";
export type { LiveCandleHandle } from "./types";

// ─── Types ─────────────────────────────────────────────────────────────────
export type {
  LiveCandleProps,
  OHLCPoint,
  TickPoint,
  CandleStyle,
  CandleBodyStyle,
  CandleWickStyle,
  CandleLiveStyle,
  CandleHoverStyle,
  VolumeStyle,
  HoverData,
  TooltipRow,
  WindowOption,
  ReferenceLine,
  Momentum,
  ThemeMode,
  ChartMode,
  DegenOptions,
  Padding,
  CandleHollowMode,
  WickColorMode,
  TooltipVariant,
  PriceDirection,
} from "./types";

// ─── Theme ─────────────────────────────────────────────────────────────────
export {
  resolvePalette,
  darkThemeVars as lcDarkThemeVars,
  lightThemeVars as lcLightThemeVars,
} from "./theme";

// ─── Style Resolution (for advanced usage) ─────────────────────────────────
export { resolveCandleStyle, resolveVolumeStyle } from "./candles";
