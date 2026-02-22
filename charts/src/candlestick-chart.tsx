"use client";

import { localPoint } from "@visx/event";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { bisector } from "d3-array";
import { AnimatePresence, motion, useSpring } from "motion/react";
import type React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChartGrid } from "./chart-grid";
import {
  ChartTooltip,
  Crosshair,
  PriceLine,
  TooltipDot,
} from "./chart-tooltip";
import { cssVars } from "./css-vars";
import { CurrentPriceLabel, PriceAxis, TimeAxis } from "./price-axis";
import type {
  CandlestickStyle,
  ChartMargin,
  OHLCDataPoint,
  PriceDirection,
  TooltipRow,
} from "./types";
import { VolumeBars } from "./volume-bars";

// ─── Performance: Batched static candles via raw SVG paths ──────────────────
// After the entrance animation completes, we switch from per-candle motion
// elements to a single batch-rendered <g> with raw SVG. This drops the DOM
// node count from ~3N (motion) to exactly 2N (wick line + body rect) and
// eliminates all spring overhead for the steady state.

interface BatchedCandlesProps {
  data: OHLCDataPoint[];
  xScale: (date: Date) => number;
  yScale: (v: number) => number;
  bodyWidth: number;
  style: Required<CandlestickStyle>;
  hoveredIndex: number | null;
}

const BatchedCandles = memo(function BatchedCandles({
  data,
  xScale,
  yScale,
  bodyWidth,
  style,
  hoveredIndex,
}: BatchedCandlesProps) {
  return (
    <g>
      {data.map((d, i) => {
        const isBullish = d.close >= d.open;
        const x = xScale(d.date);
        const bodyTop = yScale(Math.max(d.open, d.close));
        const bodyBottom = yScale(Math.min(d.open, d.close));
        const bodyH = Math.max(1, bodyBottom - bodyTop);
        const wickTop = yScale(d.high);
        const wickBottom = yScale(d.low);
        const fill = isBullish ? cssVars.bullish : cssVars.bearish;
        const muted = isBullish ? cssVars.bullishMuted : cssVars.bearishMuted;
        const isHovered = hoveredIndex === i;

        return (
          <g key={i}>
            {/* Hover glow */}
            {isHovered && (
              <rect
                fill={muted}
                height={wickBottom - wickTop + 8}
                opacity={0.8}
                rx={4}
                width={bodyWidth + 8}
                x={x - bodyWidth / 2 - 4}
                y={wickTop - 4}
              />
            )}
            {/* Wick */}
            <line
              stroke={fill}
              strokeWidth={style.wickWidth}
              x1={x}
              x2={x}
              y1={wickTop}
              y2={wickBottom}
            />
            {/* Body */}
            <rect
              fill={isBullish ? "transparent" : fill}
              height={bodyH}
              rx={style.bodyRadius}
              stroke={fill}
              strokeWidth={isBullish ? 1.5 : 0}
              width={bodyWidth}
              x={x - bodyWidth / 2}
              y={bodyTop}
            />
          </g>
        );
      })}
    </g>
  );
});

// ─── Animated Single Candlestick (entrance only) ───────────────────────────
// Used during the entrance animation. After `isLoaded` flips, we switch
// to BatchedCandles above.

interface AnimatedCandleProps {
  d: OHLCDataPoint;
  x: number;
  bodyWidth: number;
  yScale: (v: number) => number;
  index: number;
  totalCandles: number;
  animationDuration: number;
  style: Required<CandlestickStyle>;
}

const AnimatedCandle = memo(function AnimatedCandle({
  d,
  x,
  bodyWidth,
  yScale,
  index,
  totalCandles,
  animationDuration,
  style,
}: AnimatedCandleProps) {
  const isBullish = d.close >= d.open;
  const bodyTop = yScale(Math.max(d.open, d.close));
  const bodyBottom = yScale(Math.min(d.open, d.close));
  const bodyHeight = Math.max(1, bodyBottom - bodyTop);
  const wickTop = yScale(d.high);
  const wickBottom = yScale(d.low);
  const fillColor = isBullish ? cssVars.bullish : cssVars.bearish;

  // Cap stagger to max 600ms total regardless of candle count.
  // This prevents 500-candle charts from having multi-second staggers.
  const maxStaggerSec = 0.6;
  const staggerDelay = Math.min(
    (index / totalCandles) * maxStaggerSec,
    maxStaggerSec
  );
  const candleDuration = Math.min(animationDuration / 1000 * 0.35, 0.4);

  return (
    <motion.g
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.2, delay: staggerDelay }}
    >
      {/* Wick */}
      <motion.line
        animate={{ y1: wickTop, y2: wickBottom }}
        initial={{
          y1: (wickTop + wickBottom) / 2,
          y2: (wickTop + wickBottom) / 2,
        }}
        stroke={fillColor}
        strokeWidth={style.wickWidth}
        transition={{
          duration: candleDuration,
          delay: staggerDelay,
          ease: [0.85, 0, 0.15, 1],
        }}
        x1={x}
        x2={x}
      />
      {/* Body */}
      <motion.rect
        animate={{ y: bodyTop, height: bodyHeight }}
        fill={isBullish ? "transparent" : fillColor}
        initial={{
          y: (bodyTop + bodyBottom) / 2,
          height: 0,
        }}
        rx={style.bodyRadius}
        stroke={fillColor}
        strokeWidth={isBullish ? 1.5 : 0}
        transition={{
          duration: candleDuration,
          delay: staggerDelay,
          ease: [0.85, 0, 0.15, 1],
        }}
        width={bodyWidth}
        x={x - bodyWidth / 2}
      />
    </motion.g>
  );
});

// ─── Inner Chart ────────────────────────────────────────────────────────────

interface InnerChartProps {
  width: number;
  height: number;
  data: OHLCDataPoint[];
  animationDuration: number;
  showGrid: boolean;
  showVolume: boolean;
  showPriceAxis: boolean;
  showTimeAxis: boolean;
  candleStyle: Required<CandlestickStyle>;
  margin: ChartMargin;
  formatPrice?: (v: number) => string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  maxAnimatedCandles: number;
}

const bisectDate = bisector<OHLCDataPoint, Date>((d) => d.date).left;

function InnerChart({
  width,
  height,
  data,
  animationDuration,
  showGrid,
  showVolume,
  showPriceAxis,
  showTimeAxis,
  candleStyle,
  margin,
  formatPrice,
  containerRef,
  maxAnimatedCandles,
}: InnerChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setIsLoaded(true),
      animationDuration + 200
    );
    return () => clearTimeout(timer);
  }, [animationDuration]);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const volumeHeight = showVolume ? innerHeight * 0.2 : 0;
  const priceHeight = innerHeight - volumeHeight;

  // Scales
  const xScale = useMemo(
    () =>
      scaleTime<number>({
        range: [0, innerWidth],
        domain: [
          Math.min(...data.map((d) => d.date.getTime())),
          Math.max(...data.map((d) => d.date.getTime())),
        ],
      }),
    [innerWidth, data]
  );

  const yScale = useMemo(() => {
    const allLows = data.map((d) => d.low);
    const allHighs = data.map((d) => d.high);
    const min = Math.min(...allLows);
    const max = Math.max(...allHighs);
    const padding = (max - min) * 0.08;
    return scaleLinear<number>({
      range: [priceHeight, 0],
      domain: [min - padding, max + padding],
      nice: true,
    });
  }, [priceHeight, data]);

  const yScaleVolume = useMemo(
    () =>
      scaleLinear<number>({
        range: [volumeHeight, 0],
        domain: [0, Math.max(...data.map((d) => d.volume)) * 1.2],
      }),
    [volumeHeight, data]
  );

  // Candle dimensions
  const candleSpacing = useMemo(() => {
    if (data.length < 2) return 0;
    return innerWidth / data.length;
  }, [innerWidth, data.length]);

  const bodyWidth = useMemo(
    () =>
      Math.max(2, candleSpacing * candleStyle.bodyWidthRatio - candleStyle.gap),
    [candleSpacing, candleStyle]
  );

  // Decide whether to use animated or batched rendering.
  // For large datasets, skip per-candle motion entirely and use
  // a clip-path sweep for the entrance instead.
  const useAnimated = !isLoaded && data.length <= maxAnimatedCandles;

  // Interaction
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const pt = localPoint(event);
      if (!pt) return;

      const x0 = xScale.invert(pt.x - margin.left);
      const idx = bisectDate(data, x0, 1);
      const d0 = data[idx - 1];
      const d1 = data[idx];

      if (!d0) return;

      let finalIdx = idx - 1;
      if (
        d1 &&
        x0.getTime() - d0.date.getTime() > d1.date.getTime() - x0.getTime()
      ) {
        finalIdx = idx;
      }
      setHoveredIndex(finalIdx);
    },
    [xScale, data, margin.left]
  );

  const handleMouseLeave = useCallback(() => setHoveredIndex(null), []);

  if (width < 10 || height < 10) return null;

  const hoveredCandle =
    hoveredIndex !== null ? data[hoveredIndex] : null;
  const isHovering = hoveredIndex !== null;
  const canInteract = isLoaded;

  // Current price (last candle)
  const lastCandle = data[data.length - 1];
  const lastDirection: PriceDirection = lastCandle
    ? lastCandle.close >= lastCandle.open
      ? "up"
      : "down"
    : "neutral";

  // Tooltip data
  const tooltipRows: TooltipRow[] = hoveredCandle
    ? [
        {
          color: cssVars.foreground,
          label: "Open",
          value: hoveredCandle.open,
        },
        {
          color:
            hoveredCandle.close >= hoveredCandle.open
              ? cssVars.bullish
              : cssVars.bearish,
          label: "Close",
          value: hoveredCandle.close,
        },
        { color: cssVars.bullish, label: "High", value: hoveredCandle.high },
        { color: cssVars.bearish, label: "Low", value: hoveredCandle.low },
        {
          color: cssVars.foregroundMuted,
          label: "Volume",
          value: hoveredCandle.volume.toLocaleString(),
        },
      ]
    : [];

  const hoveredDirection: PriceDirection = hoveredCandle
    ? hoveredCandle.close >= hoveredCandle.open
      ? "up"
      : "down"
    : "neutral";

  const changePercent = hoveredCandle
    ? (
        ((hoveredCandle.close - hoveredCandle.open) / hoveredCandle.open) *
        100
      ).toFixed(2)
    : "0";

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      <svg aria-hidden="true" height={height} width={width}>
        <defs>
          {/* Clip for entrance animation (sweep reveal left→right) */}
          <clipPath id="candle-clip">
            <motion.rect
              animate={{ width: innerWidth }}
              height={innerHeight + 20}
              initial={{ width: 0 }}
              transition={{
                duration: animationDuration / 1000,
                ease: [0.85, 0, 0.15, 1],
              }}
              x={0}
              y={-10}
            />
          </clipPath>

          <linearGradient
            id="candle-area-grad"
            x1="0"
            x2="0"
            y1="0"
            y2="1"
          >
            <stop
              offset="0%"
              stopColor={cssVars.linePrimary}
              stopOpacity={0.08}
            />
            <stop
              offset="100%"
              stopColor={cssVars.linePrimary}
              stopOpacity={0}
            />
          </linearGradient>
        </defs>

        <rect fill="transparent" height={height} width={width} />

        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Grid */}
          {showGrid && (
            <ChartGrid
              fadeEdges
              height={priceHeight}
              showColumns
              showRows
              stroke={cssVars.grid}
              strokeDasharray="2 4"
              width={innerWidth}
              xScale={xScale}
              yScale={yScale}
            />
          )}

          {/* Crosshair */}
          <Crosshair
            height={innerHeight}
            visible={isHovering}
            x={
              hoveredIndex !== null
                ? (xScale(data[hoveredIndex]!.date) ?? 0)
                : 0
            }
          />

          {/* Horizontal price line at hovered close */}
          {hoveredCandle && (
            <PriceLine
              visible={isHovering}
              width={innerWidth}
              y={yScale(hoveredCandle.close)}
            />
          )}

          {/* Price axis labels */}
          {showPriceAxis && (
            <PriceAxis
              formatPrice={formatPrice}
              marginLeft={0}
              numTicks={6}
              width={innerWidth}
              yScale={yScale}
            />
          )}

          {/* Current price label */}
          {lastCandle && (
            <CurrentPriceLabel
              direction={lastDirection}
              formatPrice={formatPrice}
              price={lastCandle.close}
              visible={!isHovering}
              width={innerWidth}
              y={yScale(lastCandle.close)}
            />
          )}

          {/* Candlesticks — animated entrance or batched static */}
          <g clipPath="url(#candle-clip)">
            {useAnimated ? (
              // Per-candle motion.* elements for smooth entrance
              data.map((d, i) => (
                <AnimatedCandle
                  animationDuration={animationDuration}
                  bodyWidth={bodyWidth}
                  d={d}
                  index={i}
                  key={`ac-${i}`}
                  style={candleStyle}
                  totalCandles={data.length}
                  x={xScale(d.date) ?? 0}
                  yScale={(v) => yScale(v) ?? 0}
                />
              ))
            ) : (
              // Raw SVG for post-entrance or large datasets.
              // The clip-path sweep handles the reveal animation.
              <BatchedCandles
                bodyWidth={bodyWidth}
                data={data}
                hoveredIndex={hoveredIndex}
                style={candleStyle}
                xScale={(date) => xScale(date) ?? 0}
                yScale={(v) => yScale(v) ?? 0}
              />
            )}
          </g>

          {/* Volume bars */}
          {showVolume && (
            <VolumeBars
              animationDuration={animationDuration}
              data={data}
              hoveredIndex={hoveredIndex}
              innerHeight={innerHeight}
              innerWidth={innerWidth}
              volumeHeight={volumeHeight}
              xScale={(date) => xScale(date) ?? 0}
              yScaleVolume={(v) => yScaleVolume(v) ?? 0}
            />
          )}

          {/* Tooltip dots at hovered OHLC */}
          {hoveredCandle && (
            <>
              <TooltipDot
                color={cssVars.bullish}
                visible={isHovering}
                x={xScale(hoveredCandle.date) ?? 0}
                y={yScale(hoveredCandle.high)}
              />
              <TooltipDot
                color={cssVars.bearish}
                visible={isHovering}
                x={xScale(hoveredCandle.date) ?? 0}
                y={yScale(hoveredCandle.low)}
              />
            </>
          )}

          {/* Interaction overlay */}
          <rect
            fill="transparent"
            height={innerHeight}
            onMouseLeave={canInteract ? handleMouseLeave : undefined}
            onMouseMove={canInteract ? handleMouseMove : undefined}
            style={{ cursor: canInteract ? "crosshair" : "default" }}
            width={innerWidth}
            x={0}
            y={0}
          />
        </g>
      </svg>

      {/* Floating tooltip */}
      <ChartTooltip
        containerWidth={width}
        direction={hoveredDirection}
        rows={tooltipRows}
        subtitle={hoveredCandle ? `${changePercent}%` : undefined}
        title={
          hoveredCandle
            ? hoveredCandle.date.toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : undefined
        }
        visible={isHovering}
        x={
          (hoveredIndex !== null
            ? (xScale(data[hoveredIndex]!.date) ?? 0)
            : 0) + margin.left
        }
      />

      {/* Time axis */}
      {showTimeAxis && (
        <TimeAxis
          crosshairX={
            hoveredIndex !== null
              ? (xScale(data[hoveredIndex]!.date) ?? 0) + margin.left
              : null
          }
          height={height - margin.bottom + 4}
          isHovering={isHovering}
          marginLeft={margin.left}
          xScale={xScale}
        />
      )}
    </div>
  );
}

// ─── Public Component ───────────────────────────────────────────────────────

export interface CandlestickChartProps {
  /** OHLCV data array */
  data: OHLCDataPoint[];
  /** Entrance animation duration in ms */
  animationDuration?: number;
  /** Show grid lines */
  showGrid?: boolean;
  /** Show volume bars below candlesticks */
  showVolume?: boolean;
  /** Show price axis on the left */
  showPriceAxis?: boolean;
  /** Show time axis at the bottom */
  showTimeAxis?: boolean;
  /** Custom price formatter */
  formatPrice?: (v: number) => string;
  /** Chart aspect ratio (width / height) */
  aspectRatio?: string;
  /** Candlestick visual style */
  candleStyle?: CandlestickStyle;
  /** Chart margins */
  margin?: Partial<ChartMargin>;
  /**
   * Maximum number of candles that get per-element motion animations
   * on entrance. Beyond this threshold, the chart uses a clip-path
   * sweep reveal instead. Default: 150.
   */
  maxAnimatedCandles?: number;
}

const defaultCandleStyle: Required<CandlestickStyle> = {
  bodyWidthRatio: 0.65,
  wickWidth: 1.5,
  bodyRadius: 1,
  gap: 2,
};

const defaultMargin: ChartMargin = {
  top: 20,
  right: 80,
  bottom: 40,
  left: 12,
};

export function CandlestickChart({
  data,
  animationDuration = 1000,
  showGrid = true,
  showVolume = true,
  showPriceAxis = true,
  showTimeAxis = true,
  formatPrice,
  aspectRatio = "5 / 2",
  candleStyle = {},
  margin: marginOverride = {},
  maxAnimatedCandles = 150,
}: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mergedStyle = { ...defaultCandleStyle, ...candleStyle };
  const mergedMargin = { ...defaultMargin, ...marginOverride };

  return (
    <div className="relative w-full" style={{ aspectRatio }}>
      <ParentSize debounceTime={10}>
        {({ width, height }) => (
          <InnerChart
            animationDuration={animationDuration}
            candleStyle={mergedStyle}
            containerRef={containerRef}
            data={data}
            formatPrice={formatPrice}
            height={height}
            margin={mergedMargin}
            maxAnimatedCandles={maxAnimatedCandles}
            showGrid={showGrid}
            showPriceAxis={showPriceAxis}
            showTimeAxis={showTimeAxis}
            showVolume={showVolume}
            width={width}
          />
        )}
      </ParentSize>
    </div>
  );
}

export default CandlestickChart;
