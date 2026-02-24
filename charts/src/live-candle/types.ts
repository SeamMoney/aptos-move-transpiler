import type { CSSProperties } from "react";

// ─── Data Types ────────────────────────────────────────────────────────────

/** OHLCV candlestick data point */
export interface OHLCPoint {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Tick / line data point */
export interface TickPoint {
  time: number; // unix seconds
  value: number;
  volume?: number;
}

// ─── Enums ─────────────────────────────────────────────────────────────────

export type Momentum = "up" | "down" | "flat";
export type ThemeMode = "light" | "dark";
export type ChartMode = "candle" | "line";
export type TooltipVariant = "rich" | "minimal" | "canvas";
export type CandleHollowMode = boolean | "bullish";
export type WickColorMode = "body" | "fixed";
export type PriceDirection = "up" | "down" | "neutral";

// ─── Deep Candlestick Styling ──────────────────────────────────────────────

/** Body styling */
export interface CandleBodyStyle {
  /** Width as fraction of candle spacing (0–1). Default 0.65 */
  widthRatio?: number;
  /** Corner radius in px. Default 1.5 */
  radius?: number;
  /** Hollow body rendering. true = all hollow, 'bullish' = only bullish. Default 'bullish' */
  hollow?: CandleHollowMode;
  /** Stroke width for hollow candles. Default 1.5 */
  strokeWidth?: number;
  /** Vertical gradient on filled body. Default true */
  gradient?: boolean;
  /** Gradient intensity 0–1. Default 0.3 */
  gradientIntensity?: number;
  /** Drop shadow behind body. Default false */
  shadow?: boolean;
  /** Shadow blur radius. Default 4 */
  shadowBlur?: number;
  /** Shadow vertical offset. Default 2 */
  shadowOffsetY?: number;
  /** Minimum body height in px. Default 1 */
  minHeight?: number;
}

/** Wick styling */
export interface CandleWickStyle {
  /** Wick line width. Default 1.5 */
  width?: number;
  /** Line cap. Default 'round' */
  cap?: CanvasLineCap;
  /** Color mode: 'body' matches body, 'fixed' uses custom colors. Default 'body' */
  colorMode?: WickColorMode;
  /** Custom bullish wick color (colorMode='fixed'). */
  bullishColor?: string;
  /** Custom bearish wick color (colorMode='fixed'). */
  bearishColor?: string;
}

/** Live candle effects */
export interface CandleLiveStyle {
  /** Glow effect. Default true */
  glow?: boolean;
  /** Glow intensity 0–1. Default 0.5 */
  glowIntensity?: number;
  /** Pulse speed in ms. Default 1500 */
  pulseSpeed?: number;
  /** Flash border on direction change. Default true */
  borderFlash?: boolean;
}

/** Hover styling */
export interface CandleHoverStyle {
  /** Highlight background rect. Default true */
  highlight?: boolean;
  /** Highlight corner radius. Default 4 */
  highlightRadius?: number;
  /** Highlight opacity. Default 0.15 */
  highlightOpacity?: number;
  /** Brightness boost 0–1. Default 0.12 */
  brighten?: number;
}

/** Complete candlestick style config (all optional, deep-merged with defaults) */
export interface CandleStyle {
  body?: CandleBodyStyle;
  wick?: CandleWickStyle;
  live?: CandleLiveStyle;
  hover?: CandleHoverStyle;
  /** Gap between candles in px. Default 2 */
  gap?: number;
}

/** Volume bar styling */
export interface VolumeStyle {
  /** Height as fraction of chart height. Default 0.18 */
  heightRatio?: number;
  /** Opacity. Default 0.3 */
  opacity?: number;
  /** Corner radius. Default 1 */
  radius?: number;
}

// ─── Resolved Styles (internal, all fields required) ───────────────────────

export interface ResolvedCandleBody {
  widthRatio: number;
  radius: number;
  hollow: CandleHollowMode;
  strokeWidth: number;
  gradient: boolean;
  gradientIntensity: number;
  shadow: boolean;
  shadowBlur: number;
  shadowOffsetY: number;
  minHeight: number;
}

export interface ResolvedCandleWick {
  width: number;
  cap: CanvasLineCap;
  colorMode: WickColorMode;
  bullishColor: string;
  bearishColor: string;
}

export interface ResolvedCandleLive {
  glow: boolean;
  glowIntensity: number;
  pulseSpeed: number;
  borderFlash: boolean;
}

export interface ResolvedCandleHover {
  highlight: boolean;
  highlightRadius: number;
  highlightOpacity: number;
  brighten: number;
}

export interface ResolvedCandleStyle {
  body: ResolvedCandleBody;
  wick: ResolvedCandleWick;
  live: ResolvedCandleLive;
  hover: ResolvedCandleHover;
  gap: number;
}

export interface ResolvedVolumeStyle {
  heightRatio: number;
  opacity: number;
  radius: number;
}

// ─── Theme / Palette ───────────────────────────────────────────────────────

export interface LiveCandlePalette {
  bg: string;
  bgRgb: [number, number, number];
  fg: string;
  fgMuted: string;

  gridLine: string;
  gridLabel: string;

  bullish: string;
  bullishRgb: [number, number, number];
  bullishMuted: string;
  bearish: string;
  bearishRgb: [number, number, number];
  bearishMuted: string;

  wickBullish: string;
  wickBearish: string;

  volumeUp: string;
  volumeDown: string;

  line: string;
  lineRgb: [number, number, number];
  lineWidth: number;
  fillTop: string;
  fillBottom: string;

  dotUp: string;
  dotDown: string;
  dotFlat: string;
  glowUp: string;
  glowDown: string;

  crosshairLine: string;

  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  tooltipMuted: string;

  badgeBg: string;
  badgeText: string;

  dashLine: string;
  refLine: string;
  refLabel: string;
  timeLabel: string;

  labelFont: string;
  valueFont: string;
  badgeFont: string;
}

// ─── Layout ────────────────────────────────────────────────────────────────

export interface Padding {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface ChartLayout {
  w: number;
  h: number;
  dpr: number;
  pad: Required<Padding>;
  chartW: number;
  chartH: number;
  volumeH: number;
  priceH: number;
  toX: (t: number) => number;
  toY: (v: number) => number;
  toVolumeY: (v: number, maxVol: number) => number;
}

// ─── Other ─────────────────────────────────────────────────────────────────

export interface WindowOption {
  label: string;
  secs: number;
}

export interface ReferenceLine {
  value: number;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface HoverData {
  time: number;
  value?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  x: number;
  y: number;
  direction: PriceDirection;
}

export interface TooltipRow {
  label: string;
  value: string | number;
  color: string;
}

export interface DegenOptions {
  scale?: number;
  downMomentum?: boolean;
}

// ─── Particle System (internal) ────────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

export interface ParticleState {
  particles: Particle[];
  cooldown: number;
  burstCount: number;
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface LiveCandleProps {
  /** Pre-built OHLC candle data */
  candles?: OHLCPoint[];
  /** Current live candle (growing, real-time) */
  liveCandle?: OHLCPoint;
  /** Line-mode data points */
  data?: TickPoint[];
  /** Current value for line mode */
  value?: number;

  /** Chart mode. Default 'candle' */
  mode?: ChartMode;
  onModeChange?: (mode: ChartMode) => void;

  /** Visible time window in seconds. Default 3600 */
  window?: number;
  /** Window toggle buttons */
  windows?: WindowOption[];
  onWindowChange?: (secs: number) => void;

  /** Color theme. Default 'dark' */
  theme?: ThemeMode;
  /** Accent color for line mode + fallback palette derivation. Default '#3b82f6' */
  accentColor?: string;
  /** Deep candlestick styling */
  candleStyle?: CandleStyle;
  /** Volume bar styling */
  volumeStyle?: VolumeStyle;

  /** Show grid. Default true */
  grid?: boolean;
  /** Show volume bars. Default true */
  volume?: boolean;
  /** Show area fill under line. Default true */
  fill?: boolean;
  /** Show momentum arrows. Default true */
  momentum?: boolean;
  /** Show pulse ring. Default true */
  pulse?: boolean;
  /** Enable hover scrub. Default true */
  scrub?: boolean;
  /** Exaggerate Y axis for small moves. Default false */
  exaggerate?: boolean;
  /** Show price axis. Default true */
  showPriceAxis?: boolean;
  /** Show time axis. Default true */
  showTimeAxis?: boolean;
  /** Show current price badge. Default true */
  showBadge?: boolean;

  /** Degen mode. Default false */
  degen?: boolean | DegenOptions;
  /** Show loading state. Default false */
  loading?: boolean;
  /** Pause animation. Default false */
  paused?: boolean;
  /** Empty state text. Default 'No data' */
  emptyText?: string;

  /** Tooltip style. Default 'rich' */
  tooltipVariant?: TooltipVariant;
  /** Horizontal reference lines */
  referenceLines?: ReferenceLine[];

  onHover?: (data: HoverData | null) => void;

  formatPrice?: (v: number) => string;
  formatTime?: (t: number) => string;
  formatVolume?: (v: number) => string;

  lerpSpeed?: number;
  padding?: Padding;
  className?: string;
  style?: CSSProperties;
}

/** Imperative handle */
export interface LiveCandleHandle {
  /** Push a raw tick — auto-aggregates into candles if in candle mode */
  pushTick(tick: TickPoint): void;
  /** Push a complete OHLC candle */
  pushCandle(candle: OHLCPoint): void;
  /** Replace all candle data */
  setCandles(candles: OHLCPoint[]): void;
  /** Replace all line data */
  setData(data: TickPoint[]): void;
  /** Switch mode programmatically */
  setMode(mode: ChartMode): void;
}
