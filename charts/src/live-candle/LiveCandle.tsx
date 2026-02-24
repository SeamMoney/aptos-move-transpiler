"use client";

/**
 * LiveCandle — High-performance canvas candlestick + line chart.
 *
 * Combines the best of @bklit/charts (deep CSS-variable theming, rich tooltips,
 * volume bars) with Liveline's architecture (single canvas, rAF loop, ref-based
 * state, zero React re-renders, loading morphs, degen mode).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChartMode,
  DegenOptions,
  LiveCandleHandle,
  LiveCandleProps,
  OHLCPoint,
  TickPoint,
  TooltipRow,
} from "./types";
import { resolvePalette } from "./theme";
import { resolveCandleStyle, resolveVolumeStyle } from "./candles";
import { useLiveCandleEngine, type TooltipState } from "./engine";

// ─── Default formatters ────────────────────────────────────────────────────

function defaultFormatPrice(v: number): string {
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  return v.toPrecision(4);
}

function defaultFormatTime(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function defaultFormatVolume(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString();
}

// ─── Tooltip Component ─────────────────────────────────────────────────────

interface TooltipProps {
  state: TooltipState;
  containerWidth: number;
  palette: { tooltipBg: string; tooltipBorder: string; tooltipText: string; tooltipMuted: string; bullish: string; bearish: string; fgMuted: string };
}

function RichTooltip({ state, containerWidth, palette }: TooltipProps) {
  if (!state.visible) return null;

  const flipped = state.x + 200 > containerWidth;
  const dirColor =
    state.direction === "up"
      ? palette.bullish
      : state.direction === "down"
        ? palette.bearish
        : palette.fgMuted;

  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        left: flipped ? undefined : state.x + 16,
        right: flipped ? containerWidth - state.x + 16 : undefined,
        zIndex: 50,
        pointerEvents: "none",
        transition: "left 60ms ease-out, right 60ms ease-out, opacity 150ms",
        opacity: state.visible ? 1 : 0,
      }}
    >
      <div
        style={{
          background: palette.tooltipBg,
          border: `1px solid ${palette.tooltipBorder}`,
          borderRadius: 8,
          padding: "10px 14px",
          backdropFilter: "blur(12px)",
          minWidth: 140,
        }}
      >
        {state.title && (
          <div
            style={{
              color: palette.tooltipText,
              fontSize: 13,
              fontWeight: 600,
              marginBottom: state.subtitle || state.rows.length > 0 ? 6 : 0,
              fontFamily: '"SF Mono", Menlo, Monaco, monospace',
            }}
          >
            {state.title}
          </div>
        )}
        {state.subtitle && (
          <div
            style={{
              color: dirColor,
              fontSize: 11,
              fontWeight: 500,
              marginBottom: state.rows.length > 0 ? 8 : 0,
            }}
          >
            {state.subtitle}
          </div>
        )}
        {state.rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "2px 0",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: row.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: palette.tooltipMuted, fontSize: 12 }}>
                {row.label}
              </span>
            </div>
            <span
              style={{
                color: palette.tooltipText,
                fontSize: 12,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                fontFamily: '"SF Mono", Menlo, Monaco, monospace',
              }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mode Toggle ───────────────────────────────────────────────────────────

interface ModeToggleProps {
  mode: ChartMode;
  onModeChange?: (mode: ChartMode) => void;
  fgMuted: string;
  fg: string;
}

function ModeToggle({ mode, onModeChange, fgMuted, fg }: ModeToggleProps) {
  if (!onModeChange) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        display: "flex",
        gap: 2,
        zIndex: 10,
      }}
    >
      {(["candle", "line"] as ChartMode[]).map((m) => (
        <button
          key={m}
          onClick={() => onModeChange(m)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "3px 8px",
            borderRadius: 4,
            fontSize: 11,
            fontFamily: '"SF Mono", Menlo, monospace',
            color: mode === m ? fg : fgMuted,
            opacity: mode === m ? 1 : 0.5,
            fontWeight: mode === m ? 600 : 400,
          }}
        >
          {m === "candle" ? "OHLC" : "Line"}
        </button>
      ))}
    </div>
  );
}

// ─── Window Buttons ────────────────────────────────────────────────────────

interface WindowBarProps {
  windows: { label: string; secs: number }[];
  activeSecs: number;
  onChange: (secs: number) => void;
  fg: string;
  fgMuted: string;
}

function WindowBar({ windows, activeSecs, onChange, fg, fgMuted }: WindowBarProps) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 4,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        gap: 2,
        zIndex: 10,
      }}
    >
      {windows.map((w) => (
        <button
          key={w.secs}
          onClick={() => onChange(w.secs)}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 10,
            fontFamily: '"SF Mono", Menlo, monospace',
            color: activeSecs === w.secs ? fg : fgMuted,
            opacity: activeSecs === w.secs ? 1 : 0.5,
            fontWeight: activeSecs === w.secs ? 600 : 400,
          }}
        >
          {w.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export const LiveCandle = forwardRef<LiveCandleHandle, LiveCandleProps>(
  function LiveCandle(props, ref) {
    const {
      candles: propCandles = [],
      liveCandle: propLiveCandle,
      data: propData = [],
      value: propValue = 0,
      mode: propMode = "candle",
      onModeChange,
      window: windowSecs = 3600,
      windows,
      onWindowChange,
      theme = "dark",
      accentColor = "#3b82f6",
      candleStyle: candleStyleProp,
      volumeStyle: volumeStyleProp,
      grid = true,
      volume = true,
      fill = true,
      momentum = true,
      pulse = true,
      scrub = true,
      exaggerate = false,
      showPriceAxis = true,
      showTimeAxis = true,
      showBadge = true,
      degen,
      loading = false,
      paused = false,
      emptyText = "No data",
      tooltipVariant = "rich",
      referenceLines = [],
      onHover,
      formatPrice = defaultFormatPrice,
      formatTime = defaultFormatTime,
      formatVolume = defaultFormatVolume,
      lerpSpeed = 0.08,
      padding,
      className,
      style,
    } = props;

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Mutable data refs (updated without re-render)
    const [candles, setCandles] = useState(propCandles);
    const [lineData, setLineData] = useState(propData);
    const [lineValue, setLineValue] = useState(propValue);
    const [liveCandle, setLiveCandle] = useState(propLiveCandle);
    const [mode, setMode] = useState(propMode);
    const [activeWindow, setActiveWindow] = useState(windowSecs);

    const candlesRef = useRef(candles);
    const liveCandleRef = useRef(liveCandle);
    const dataRef = useRef(lineData);
    const valueRef = useRef(lineValue);

    candlesRef.current = candles;
    liveCandleRef.current = liveCandle;
    dataRef.current = lineData;
    valueRef.current = lineValue;

    // Sync props
    useEffect(() => setCandles(propCandles), [propCandles]);
    useEffect(() => setLineData(propData), [propData]);
    useEffect(() => setLineValue(propValue), [propValue]);
    useEffect(() => setLiveCandle(propLiveCandle), [propLiveCandle]);
    useEffect(() => setMode(propMode), [propMode]);
    useEffect(() => setActiveWindow(windowSecs), [windowSecs]);

    // Resolve palette from CSS vars + accent
    const palette = useMemo(
      () => resolvePalette(containerRef.current, accentColor, theme),
      [accentColor, theme]
    );

    // Resolve styles
    const candleStyle = useMemo(
      () => resolveCandleStyle(candleStyleProp, palette),
      [candleStyleProp, palette]
    );
    const volStyle = useMemo(
      () => resolveVolumeStyle(volumeStyleProp),
      [volumeStyleProp]
    );

    // Degen config
    const degenOpts: DegenOptions | undefined = useMemo(() => {
      if (degen === true) return {};
      if (degen === false || degen === undefined) return undefined;
      return degen;
    }, [degen]);

    // Tooltip state (updated by engine, triggers re-render only for tooltip)
    const [tooltip, setTooltip] = useState<TooltipState>({
      visible: false,
      x: 0,
      y: 0,
      rows: [],
      title: "",
      subtitle: "",
      direction: "neutral",
    });

    const tooltipThrottle = useRef(0);
    const handleTooltipUpdate = useCallback((state: TooltipState) => {
      const now = performance.now();
      if (now - tooltipThrottle.current < 32) return; // ~30fps for tooltip updates
      tooltipThrottle.current = now;
      setTooltip(state);
    }, []);

    // Engine config
    const config = useMemo(
      () => ({
        mode,
        windowSecs: activeWindow,
        lerpSpeed,
        showGrid: grid,
        showFill: fill,
        showVolume: volume,
        showPriceAxis,
        showTimeAxis,
        showBadge,
        scrub,
        exaggerate,
        loading,
        paused,
        showMomentum: momentum,
        pulse,
        degen: degenOpts,
        refs: referenceLines,
        formatPrice,
        formatTime,
        formatVolume,
        volumeStyle: volStyle,
        candleStyle,
      }),
      [
        mode, activeWindow, lerpSpeed, grid, fill, volume,
        showPriceAxis, showTimeAxis, showBadge, scrub, exaggerate,
        loading, paused, momentum, pulse, degenOpts, referenceLines,
        formatPrice, formatTime, formatVolume, volStyle, candleStyle,
      ]
    );

    // Run the engine
    useLiveCandleEngine({
      canvasRef,
      containerRef,
      palette,
      candlesRef,
      liveCandleRef,
      dataRef,
      valueRef,
      config,
      onHover,
      onTooltipUpdate: handleTooltipUpdate,
    });

    // Imperative handle
    useImperativeHandle(ref, () => ({
      pushTick(tick: TickPoint) {
        setLineData((prev) => {
          const next = [...prev, tick];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
        setLineValue(tick.value);
      },
      pushCandle(candle: OHLCPoint) {
        setCandles((prev) => {
          const next = [...prev, candle];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      },
      setCandles(c: OHLCPoint[]) {
        setCandles(c);
      },
      setData(d: TickPoint[]) {
        setLineData(d);
        if (d.length > 0) setLineValue(d[d.length - 1].value);
      },
      setMode(m: ChartMode) {
        setMode(m);
        onModeChange?.(m);
      },
    }));

    // Container width for tooltip flipping
    const [containerWidth, setContainerWidth] = useState(0);
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver((entries) => {
        const e = entries[0];
        if (e) setContainerWidth(e.contentRect.width);
      });
      ro.observe(el);
      setContainerWidth(el.getBoundingClientRect().width);
      return () => ro.disconnect();
    }, []);

    const handleModeChange = useCallback(
      (m: ChartMode) => {
        setMode(m);
        onModeChange?.(m);
      },
      [onModeChange]
    );

    const handleWindowChange = useCallback(
      (secs: number) => {
        setActiveWindow(secs);
        onWindowChange?.(secs);
      },
      [onWindowChange]
    );

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          ...style,
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            cursor: scrub ? "crosshair" : "default",
          }}
        />

        {/* Rich DOM tooltip */}
        {tooltipVariant === "rich" && (
          <RichTooltip
            state={tooltip}
            containerWidth={containerWidth}
            palette={palette}
          />
        )}

        {/* Mode toggle */}
        {onModeChange && (
          <ModeToggle
            mode={mode}
            onModeChange={handleModeChange}
            fg={palette.fg}
            fgMuted={palette.fgMuted}
          />
        )}

        {/* Window buttons */}
        {windows && windows.length > 0 && (
          <WindowBar
            windows={windows}
            activeSecs={activeWindow}
            onChange={handleWindowChange}
            fg={palette.fg}
            fgMuted={palette.fgMuted}
          />
        )}
      </div>
    );
  }
);

export default LiveCandle;
