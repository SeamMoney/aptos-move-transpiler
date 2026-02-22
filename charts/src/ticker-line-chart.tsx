"use client";

import { curveMonotoneX } from "@visx/curve";
import { localPoint } from "@visx/event";
import { LinearGradient } from "@visx/gradient";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AreaClosed, LinePath } from "@visx/shape";
import { bisector } from "d3-array";
import { AnimatePresence, motion, useSpring } from "motion/react";
import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  ChartMargin,
  PriceDirection,
  StreamConfig,
  TickerDataPoint,
  TooltipRow,
} from "./types";
import { lerp, springInterpolate, useAnimationFrame } from "./use-animation-frame";

// ─── Live Pulse Dot ─────────────────────────────────────────────────────────

interface PulseDotProps {
  x: number;
  y: number;
  color: string;
  visible: boolean;
}

function PulseDot({ x, y, color, visible }: PulseDotProps) {
  const springX = useSpring(x, { stiffness: 200, damping: 24 });
  const springY = useSpring(y, { stiffness: 200, damping: 24 });

  useEffect(() => { springX.set(x); }, [x, springX]);
  useEffect(() => { springY.set(y); }, [y, springY]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
        >
          {/* Outer pulse ring */}
          <motion.circle
            animate={{
              r: [4, 14, 4],
              opacity: [0.4, 0, 0.4],
            }}
            cx={springX}
            cy={springY}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          {/* Glow */}
          <motion.circle
            cx={springX}
            cy={springY}
            fill={color}
            opacity={0.2}
            r={8}
            style={{ filter: "blur(4px)" }}
          />
          {/* Core dot */}
          <motion.circle
            cx={springX}
            cy={springY}
            fill={color}
            r={3.5}
            stroke={cssVars.background}
            strokeWidth={2}
          />
        </motion.g>
      )}
    </AnimatePresence>
  );
}

// ─── Streaming data buffer ──────────────────────────────────────────────────

interface StreamState {
  points: TickerDataPoint[];
  displayPrice: number;
  displayVelocity: number;
  targetPrice: number;
}

// ─── Inner Chart ────────────────────────────────────────────────────────────

interface InnerChartProps {
  width: number;
  height: number;
  data: TickerDataPoint[];
  isStreaming: boolean;
  streamConfig: Required<StreamConfig>;
  animationDuration: number;
  showGrid: boolean;
  showArea: boolean;
  showPriceAxis: boolean;
  showTimeAxis: boolean;
  lineColor: string;
  areaOpacity: number;
  margin: ChartMargin;
  formatPrice?: (v: number) => string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const bisectDate = bisector<TickerDataPoint, Date>((d) => d.date).left;

function InnerChart({
  width,
  height,
  data,
  isStreaming,
  streamConfig,
  animationDuration,
  showGrid,
  showArea,
  showPriceAxis,
  showTimeAxis,
  lineColor,
  areaOpacity,
  margin,
  formatPrice,
  containerRef,
}: InnerChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [clipWidth, setClipWidth] = useState(0);
  const streamRef = useRef<StreamState>({
    points: data,
    displayPrice: data[data.length - 1]?.price ?? 0,
    displayVelocity: 0,
    targetPrice: data[data.length - 1]?.price ?? 0,
  });

  // Smooth streaming interpolation
  const [smoothedData, setSmoothedData] = useState(data);

  useAnimationFrame(
    (dt) => {
      const state = streamRef.current;
      if (!isStreaming) return;

      if (streamConfig.springPhysics) {
        const result = springInterpolate(
          state.displayPrice,
          state.targetPrice,
          state.displayVelocity,
          180,
          24,
          dt / 1000
        );
        state.displayPrice = result.value;
        state.displayVelocity = result.velocity;
      } else {
        state.displayPrice = lerp(
          state.displayPrice,
          state.targetPrice,
          streamConfig.smoothing
        );
      }

      // Update last point with interpolated value
      if (state.points.length > 0) {
        const updated = [...state.points];
        const last = updated[updated.length - 1]!;
        updated[updated.length - 1] = { ...last, price: state.displayPrice };
        setSmoothedData(updated);
      }
    },
    isStreaming,
    streamConfig.fps
  );

  // Keep stream state in sync with incoming data
  useEffect(() => {
    streamRef.current.points = data;
    streamRef.current.targetPrice = data[data.length - 1]?.price ?? 0;
    if (!isStreaming) {
      setSmoothedData(data);
    }
  }, [data, isStreaming]);

  // Entrance animation
  useEffect(() => {
    requestAnimationFrame(() => {
      setClipWidth(1);
      setTimeout(() => setIsLoaded(true), animationDuration);
    });
  }, [animationDuration]);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const displayData = isStreaming ? smoothedData : data;

  // Scales
  const xScale = useMemo(
    () =>
      scaleTime<number>({
        range: [0, innerWidth],
        domain: [
          Math.min(...displayData.map((d) => d.date.getTime())),
          Math.max(...displayData.map((d) => d.date.getTime())),
        ],
      }),
    [innerWidth, displayData]
  );

  const yScale = useMemo(() => {
    const prices = displayData.map((d) => d.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const padding = (max - min) * 0.1 || 1;
    return scaleLinear<number>({
      range: [innerHeight, 0],
      domain: [min - padding, max + padding],
      nice: true,
    });
  }, [innerHeight, displayData]);

  // Path ref for entrance animation
  const pathRef = useRef<SVGPathElement>(null);

  // Interaction
  const handleMouseMove = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const pt = localPoint(event);
      if (!pt) return;

      const x0 = xScale.invert(pt.x - margin.left);
      const idx = bisectDate(displayData, x0, 1);
      const d0 = displayData[idx - 1];
      const d1 = displayData[idx];
      if (!d0) return;

      let finalIdx = idx - 1;
      if (d1 && x0.getTime() - d0.date.getTime() > d1.date.getTime() - x0.getTime()) {
        finalIdx = idx;
      }
      setHoveredIndex(finalIdx);
    },
    [xScale, displayData, margin.left]
  );

  const handleMouseLeave = useCallback(() => setHoveredIndex(null), []);

  if (width < 10 || height < 10) return null;

  const hoveredPoint = hoveredIndex !== null ? displayData[hoveredIndex] : null;
  const isHovering = hoveredIndex !== null;
  const canInteract = isLoaded;

  // Last point for live indicator
  const lastPoint = displayData[displayData.length - 1];
  const prevPoint = displayData.length > 1 ? displayData[displayData.length - 2] : null;
  const lastDirection: PriceDirection = lastPoint && prevPoint
    ? lastPoint.price >= prevPoint.price ? "up" : "down"
    : "neutral";

  // Tooltip
  const tooltipRows: TooltipRow[] = hoveredPoint
    ? [
        { color: lineColor, label: "Price", value: hoveredPoint.price },
        ...(hoveredPoint.volume != null
          ? [{ color: cssVars.foregroundMuted, label: "Volume", value: hoveredPoint.volume.toLocaleString() }]
          : []),
      ]
    : [];

  const easing = "cubic-bezier(0.85, 0, 0.15, 1)";

  return (
    <div className="relative h-full w-full" ref={containerRef}>
      <svg aria-hidden="true" height={height} width={width}>
        <defs>
          <clipPath id="ticker-clip">
            <rect
              height={innerHeight + 20}
              style={{
                transition:
                  !isLoaded && clipWidth > 0
                    ? `width ${animationDuration}ms ${easing}`
                    : "none",
              }}
              width={isLoaded ? innerWidth : clipWidth}
              x={0}
              y={-10}
            />
          </clipPath>

          {/* Line edge fade */}
          <linearGradient id="ticker-line-grad" x1="0%" x2="100%" y1="0%" y2="0%">
            <stop offset="0%" stopColor={lineColor} stopOpacity={0} />
            <stop offset="8%" stopColor={lineColor} stopOpacity={1} />
            <stop offset="92%" stopColor={lineColor} stopOpacity={1} />
            <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>

          {/* Area gradient */}
          <LinearGradient
            from={lineColor}
            fromOpacity={areaOpacity}
            id="ticker-area-grad"
            to={lineColor}
            toOpacity={0}
          />

          {/* Glow filter for the live dot */}
          <filter id="ticker-glow">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
        </defs>

        <rect fill="transparent" height={height} width={width} />

        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Grid */}
          {showGrid && (
            <ChartGrid
              fadeEdges
              height={innerHeight}
              showRows
              stroke={cssVars.grid}
              width={innerWidth}
              xScale={xScale}
              yScale={yScale}
            />
          )}

          {/* Crosshair */}
          <Crosshair
            height={innerHeight}
            visible={isHovering}
            x={hoveredIndex !== null ? (xScale(displayData[hoveredIndex]!.date) ?? 0) : 0}
          />

          {/* Hovered price line */}
          {hoveredPoint && (
            <PriceLine
              visible={isHovering}
              width={innerWidth}
              y={yScale(hoveredPoint.price)}
            />
          )}

          {/* Price axis */}
          {showPriceAxis && (
            <PriceAxis
              formatPrice={formatPrice}
              marginLeft={0}
              numTicks={5}
              width={innerWidth}
              yScale={yScale}
            />
          )}

          {/* Current price badge */}
          {lastPoint && (
            <CurrentPriceLabel
              direction={lastDirection}
              formatPrice={formatPrice}
              price={lastPoint.price}
              visible={!isHovering}
              width={innerWidth}
              y={yScale(lastPoint.price)}
            />
          )}

          {/* Main chart content (clipped for entrance) */}
          <g clipPath="url(#ticker-clip)">
            {/* Dimmed base line on hover */}
            <motion.g
              animate={{ opacity: isHovering ? 0.3 : 1 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
            >
              {/* Area fill */}
              {showArea && (
                <AreaClosed
                  curve={curveMonotoneX}
                  data={displayData}
                  fill="url(#ticker-area-grad)"
                  x={(d) => xScale(d.date) ?? 0}
                  y={(d) => yScale(d.price) ?? 0}
                  yScale={yScale}
                />
              )}

              {/* Line */}
              <LinePath
                curve={curveMonotoneX}
                data={displayData}
                innerRef={pathRef}
                stroke="url(#ticker-line-grad)"
                strokeLinecap="round"
                strokeWidth={2}
                x={(d) => xScale(d.date) ?? 0}
                y={(d) => yScale(d.price) ?? 0}
              />
            </motion.g>
          </g>

          {/* Hovered tooltip dot */}
          {hoveredPoint && (
            <TooltipDot
              color={lineColor}
              visible={isHovering}
              x={xScale(hoveredPoint.date) ?? 0}
              y={yScale(hoveredPoint.price)}
            />
          )}

          {/* Live pulse dot at last point */}
          {lastPoint && isStreaming && !isHovering && (
            <PulseDot
              color={lastDirection === "up" ? cssVars.bullish : cssVars.bearish}
              visible
              x={xScale(lastPoint.date) ?? 0}
              y={yScale(lastPoint.price)}
            />
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

      {/* Tooltip */}
      <ChartTooltip
        containerWidth={width}
        direction={
          hoveredPoint && hoveredIndex! > 0
            ? hoveredPoint.price >= displayData[hoveredIndex! - 1]!.price
              ? "up"
              : "down"
            : "neutral"
        }
        rows={tooltipRows}
        title={
          hoveredPoint
            ? hoveredPoint.date.toLocaleString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })
            : undefined
        }
        visible={isHovering}
        x={
          (hoveredIndex !== null
            ? (xScale(displayData[hoveredIndex]!.date) ?? 0)
            : 0) + margin.left
        }
      />

      {/* Time axis */}
      {showTimeAxis && (
        <TimeAxis
          crosshairX={
            hoveredIndex !== null
              ? (xScale(displayData[hoveredIndex]!.date) ?? 0) + margin.left
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

// ─── Public Component with imperative handle for pushing data ───────────────

export interface TickerLineChartHandle {
  /** Push a new data point into the streaming buffer */
  push(point: TickerDataPoint): void;
  /** Replace all data */
  setData(points: TickerDataPoint[]): void;
}

export interface TickerLineChartProps {
  /** Initial data points */
  data: TickerDataPoint[];
  /** Enable real-time streaming mode */
  streaming?: boolean;
  /** Streaming configuration */
  streamConfig?: StreamConfig;
  /** Entrance animation duration in ms */
  animationDuration?: number;
  /** Show background grid */
  showGrid?: boolean;
  /** Show gradient area under the line */
  showArea?: boolean;
  /** Show price axis */
  showPriceAxis?: boolean;
  /** Show time axis */
  showTimeAxis?: boolean;
  /** Line color (CSS value or variable) */
  lineColor?: string;
  /** Area gradient opacity (0-1) */
  areaOpacity?: number;
  /** Price formatter */
  formatPrice?: (v: number) => string;
  /** Aspect ratio */
  aspectRatio?: string;
  /** Chart margins */
  margin?: Partial<ChartMargin>;
}

const defaultStreamConfig: Required<StreamConfig> = {
  fps: 60,
  maxPoints: 500,
  smoothing: 0.15,
  springPhysics: true,
};

const defaultMargin: ChartMargin = {
  top: 20,
  right: 80,
  bottom: 40,
  left: 12,
};

export const TickerLineChart = forwardRef<TickerLineChartHandle, TickerLineChartProps>(
  function TickerLineChart(
    {
      data: initialData,
      streaming = false,
      streamConfig = {},
      animationDuration = 900,
      showGrid = true,
      showArea = true,
      showPriceAxis = true,
      showTimeAxis = true,
      lineColor = cssVars.linePrimary,
      areaOpacity = 0.08,
      formatPrice,
      aspectRatio = "5 / 2",
      margin: marginOverride = {},
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState(initialData);
    const mergedStream = { ...defaultStreamConfig, ...streamConfig };
    const mergedMargin = { ...defaultMargin, ...marginOverride };

    // Sync with prop changes
    useEffect(() => {
      setData(initialData);
    }, [initialData]);

    // Imperative API for pushing real-time data
    useImperativeHandle(ref, () => ({
      push(point: TickerDataPoint) {
        setData((prev) => {
          const next = [...prev, point];
          if (next.length > mergedStream.maxPoints) {
            return next.slice(next.length - mergedStream.maxPoints);
          }
          return next;
        });
      },
      setData(points: TickerDataPoint[]) {
        setData(points);
      },
    }));

    return (
      <div className="relative w-full" style={{ aspectRatio }}>
        <ParentSize debounceTime={10}>
          {({ width, height }) => (
            <InnerChart
              areaOpacity={areaOpacity}
              animationDuration={animationDuration}
              containerRef={containerRef}
              data={data}
              formatPrice={formatPrice}
              height={height}
              isStreaming={streaming}
              lineColor={lineColor}
              margin={mergedMargin}
              showArea={showArea}
              showGrid={showGrid}
              showPriceAxis={showPriceAxis}
              showTimeAxis={showTimeAxis}
              streamConfig={mergedStream}
              width={width}
            />
          )}
        </ParentSize>
      </div>
    );
  }
);

export default TickerLineChart;
