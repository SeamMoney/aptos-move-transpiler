"use client";

/**
 * LiveCandle animation engine.
 *
 * Runs a persistent requestAnimationFrame loop with ref-based state.
 * Zero React re-renders during animation. Supports candle + line pipelines.
 */

import { useCallback, useEffect, useRef } from "react";
import type {
  DegenOptions,
  HoverData,
  LiveCandlePalette,
  Momentum,
  OHLCPoint,
  ParticleState,
  ReferenceLine,
  ResolvedCandleStyle,
  ResolvedVolumeStyle,
  TickPoint,
  TooltipRow,
  ChartMode,
} from "./types";
import {
  lerp,
  clamp,
  computeCandleRange,
  computeLineRange,
  detectCandleMomentum,
  detectMomentum,
  interpolateAtTime,
  candleAtTime,
  maxVolume,
  loadingY,
  loadingBreath,
  loadingAmplitude,
  LOADING_SCROLL_SPEED,
  drawSpline,
} from "./math";
import { blendColors } from "./theme";
import {
  drawGrid,
  drawTimeAxis,
  drawReferenceLines,
  drawEdgeFade,
  drawDot,
  drawArrows,
  drawCrosshair,
  drawLoading,
  drawLine,
  spawnParticles,
  drawParticles,
  drawCandleCrosshair,
} from "./render";
import {
  drawAllCandles,
  drawVolumeBars,
  drawClosePrice,
  drawPriceBadge,
  resolveCandleStyle,
  resolveVolumeStyle,
} from "./candles";

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_DELTA = 50;
const ADAPTIVE_SPEED_BOOST = 0.2;
const WINDOW_BUFFER = 0.05;

// ─── Engine State ──────────────────────────────────────────────────────────

export interface EngineState {
  displayValue: number;
  displayClose: number;
  displayMin: number;
  displayMax: number;
  rangeInited: boolean;
  chartReveal: number;
  shakeAmplitude: number;
  particles: ParticleState;
  lastFrame: number;

  // Live candle smooth OHLC
  liveOpen: number;
  liveHigh: number;
  liveLow: number;
  liveClose: number;
}

function createEngineState(initialValue = 0): EngineState {
  return {
    displayValue: initialValue,
    displayClose: initialValue,
    displayMin: 0,
    displayMax: 0,
    rangeInited: false,
    chartReveal: 0,
    shakeAmplitude: 0,
    particles: { particles: [], cooldown: 0, burstCount: 0 },
    lastFrame: 0,
    liveOpen: 0,
    liveHigh: 0,
    liveLow: 0,
    liveClose: 0,
  };
}

// ─── Config (synced every render, read from rAF loop) ──────────────────────

interface EngineConfig {
  mode: ChartMode;
  windowSecs: number;
  lerpSpeed: number;
  showGrid: boolean;
  showFill: boolean;
  showVolume: boolean;
  showPriceAxis: boolean;
  showTimeAxis: boolean;
  showBadge: boolean;
  scrub: boolean;
  exaggerate: boolean;
  loading: boolean;
  paused: boolean;
  showMomentum: boolean;
  pulse: boolean;
  degen: DegenOptions | undefined;
  refs: ReferenceLine[];
  formatPrice: (v: number) => string;
  formatTime: (t: number) => string;
  formatVolume: (v: number) => string;
  volumeStyle: ResolvedVolumeStyle;
  candleStyle: ResolvedCandleStyle;
}

// ─── Tooltip State (written by engine, read by React for DOM tooltip) ─────

export interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  rows: TooltipRow[];
  title: string;
  subtitle: string;
  direction: "up" | "down" | "neutral";
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export interface UseLiveCandleEngineOpts {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  palette: LiveCandlePalette;

  // Data refs (updated externally)
  candlesRef: React.MutableRefObject<OHLCPoint[]>;
  liveCandleRef: React.MutableRefObject<OHLCPoint | undefined>;
  dataRef: React.MutableRefObject<TickPoint[]>;
  valueRef: React.MutableRefObject<number>;

  // Config
  config: EngineConfig;

  // Callbacks
  onHover?: (data: HoverData | null) => void;
  onTooltipUpdate: (state: TooltipState) => void;
}

export function useLiveCandleEngine(opts: UseLiveCandleEngineOpts): void {
  const {
    canvasRef,
    containerRef,
    palette,
    candlesRef,
    liveCandleRef,
    dataRef,
    valueRef,
    config,
    onHover,
    onTooltipUpdate,
  } = opts;

  const stateRef = useRef<EngineState>(createEngineState());
  const sizeRef = useRef({ w: 0, h: 0 });
  const hoverXRef = useRef<number | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const onTooltipRef = useRef(onTooltipUpdate);
  onTooltipRef.current = onTooltipUpdate;

  // ── ResizeObserver ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) {
        sizeRef.current = {
          w: e.contentRect.width,
          h: e.contentRect.height,
        };
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    sizeRef.current = { w: rect.width, h: rect.height };
    return () => ro.disconnect();
  }, [containerRef]);

  // ── Mouse Events ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      hoverXRef.current = e.clientX - rect.left;
    };
    const onLeave = () => {
      hoverXRef.current = null;
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [containerRef]);

  // ── rAF Loop ──
  const draw = useCallback(() => {
    if (document.hidden) {
      requestAnimationFrame(draw);
      return;
    }

    const canvas = canvasRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || w === 0 || h === 0) {
      requestAnimationFrame(draw);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      requestAnimationFrame(draw);
      return;
    }

    const pal = paletteRef.current;
    const cfg = configRef.current;
    const state = stateRef.current;
    const now_ms = performance.now();
    const dt = state.lastFrame
      ? Math.min(now_ms - state.lastFrame, MAX_DELTA)
      : 16.67;
    state.lastFrame = now_ms;

    // DPR-aware canvas sizing
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const tw = Math.round(w * dpr);
    const th = Math.round(h * dpr);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = { top: 12, right: 80, bottom: 28, left: 12 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    // Branch: candle mode vs line mode
    if (cfg.mode === "candle") {
      runCandleFrame(
        ctx, w, h, pad, chartW, chartH,
        candlesRef.current, liveCandleRef.current,
        pal, cfg, state, hoverXRef.current,
        now_ms, dt, onHoverRef.current, onTooltipRef.current
      );
    } else {
      runLineFrame(
        ctx, w, h, pad, chartW, chartH,
        dataRef.current, valueRef.current,
        pal, cfg, state, hoverXRef.current,
        now_ms, dt, onHoverRef.current, onTooltipRef.current
      );
    }

    requestAnimationFrame(draw);
  }, [canvasRef, candlesRef, liveCandleRef, dataRef, valueRef]);

  useEffect(() => {
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // Visibility
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [draw]);
}

// ─── Candle Pipeline ───────────────────────────────────────────────────────

function runCandleFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
  candles: OHLCPoint[],
  liveCandle: OHLCPoint | undefined,
  pal: LiveCandlePalette,
  cfg: EngineConfig,
  state: EngineState,
  hoverX: number | null,
  now_ms: number,
  dt: number,
  onHover: ((data: HoverData | null) => void) | undefined,
  onTooltip: (state: TooltipState) => void
): void {
  const hasData = candles.length >= 1 || liveCandle !== undefined;
  const allCandles = liveCandle ? [...candles, liveCandle] : candles;

  // Reveal
  const revealTarget = !cfg.loading && hasData ? 1 : 0;
  state.chartReveal = lerp(
    state.chartReveal,
    revealTarget,
    revealTarget === 1 ? 0.09 : 0.14,
    dt
  );
  if (Math.abs(state.chartReveal - revealTarget) < 0.005)
    state.chartReveal = revealTarget;
  const reveal = state.chartReveal;

  if (!hasData) {
    state.rangeInited = false;
    drawLoading(ctx, pal, pad.left, chartW, pad.top + chartH / 2, chartH, now_ms, cfg.loading);
    drawEdgeFade(ctx, pad.left, h);
    onTooltip({ visible: false, x: 0, y: 0, rows: [], title: "", subtitle: "", direction: "neutral" });
    return;
  }

  // Smooth live OHLC
  if (liveCandle) {
    state.liveOpen = lerp(state.liveOpen || liveCandle.open, liveCandle.open, cfg.lerpSpeed, dt);
    state.liveHigh = lerp(state.liveHigh || liveCandle.high, liveCandle.high, cfg.lerpSpeed, dt);
    state.liveLow = lerp(state.liveLow || liveCandle.low, liveCandle.low, cfg.lerpSpeed, dt);
    state.liveClose = lerp(state.liveClose || liveCandle.close, liveCandle.close, cfg.lerpSpeed, dt);
    state.displayClose = state.liveClose;
  } else if (candles.length > 0) {
    const last = candles[candles.length - 1];
    state.displayClose = lerp(state.displayClose || last.close, last.close, cfg.lerpSpeed, dt);
  }

  // Window
  const now = Date.now() / 1000;
  const rightEdge = now + cfg.windowSecs * WINDOW_BUFFER;
  const leftEdge = rightEdge - cfg.windowSecs;

  // Visible candles
  const visible: OHLCPoint[] = [];
  for (const c of allCandles) {
    if (c.time >= leftEdge - cfg.windowSecs * 0.1 && c.time <= rightEdge) {
      visible.push(c);
    }
  }
  if (visible.length < 1) {
    drawLoading(ctx, pal, pad.left, chartW, pad.top + chartH / 2, chartH, now_ms, cfg.loading);
    drawEdgeFade(ctx, pad.left, h);
    return;
  }

  // Volume layout
  const volStyle = cfg.volumeStyle;
  const showVol = cfg.showVolume && visible.some((c) => c.volume !== undefined && c.volume > 0);
  const volumeH = showVol ? chartH * volStyle.heightRatio : 0;
  const priceH = chartH - volumeH;

  // Y range
  const computed = computeCandleRange(visible, liveCandle, cfg.exaggerate);
  if (!state.rangeInited) {
    state.displayMin = computed.min;
    state.displayMax = computed.max;
    state.rangeInited = true;
  } else {
    state.displayMin = lerp(state.displayMin, computed.min, cfg.lerpSpeed, dt);
    state.displayMax = lerp(state.displayMax, computed.max, cfg.lerpSpeed, dt);
  }
  const minVal = state.displayMin;
  const maxVal = state.displayMax;
  const valRange = maxVal - minVal || 0.001;

  const toX = (t: number) =>
    pad.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW;
  const toY = (v: number) =>
    pad.top + (1 - (v - minVal) / valRange) * priceH;

  const candleSpacing =
    visible.length > 1
      ? Math.abs(toX(visible[1].time) - toX(visible[0].time))
      : chartW / 30;

  // Momentum
  const momentum = detectCandleMomentum(visible);

  // Hover detection
  let hoveredIndex: number | null = null;
  if (hoverX !== null && cfg.scrub) {
    const hoverTime =
      leftEdge + ((hoverX - pad.left) / chartW) * (rightEdge - leftEdge);
    const idx = candleAtTime(allCandles, hoverTime);
    if (idx >= 0) hoveredIndex = idx;
  }

  // Shake
  let shakeX = 0;
  let shakeY = 0;
  if (cfg.degen && state.shakeAmplitude > 0.2) {
    shakeX = (Math.random() - 0.5) * 2 * state.shakeAmplitude;
    shakeY = (Math.random() - 0.5) * 2 * state.shakeAmplitude;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }
  if (cfg.degen) {
    state.shakeAmplitude *= Math.pow(0.002, dt / 1000);
    if (state.shakeAmplitude < 0.2) state.shakeAmplitude = 0;
  }

  // ── Draw: grid ──
  const gridAlpha =
    reveal < 0.7 ? Math.pow(Math.max(0, reveal - 0.15) / 0.55, 2) : 1;
  if (cfg.showGrid) {
    drawGrid(
      ctx, pal, pad, w, chartW, priceH, minVal, valRange,
      toY, gridAlpha, cfg.formatPrice, cfg.showPriceAxis
    );
  }

  // ── Reference lines ──
  if (cfg.refs.length > 0) {
    drawReferenceLines(ctx, cfg.refs, toY, pad.left, w - pad.right, pal, reveal);
  }

  // ── Volume ──
  if (showVol && volumeH > 0) {
    const mVol = maxVolume(visible);
    drawVolumeBars(
      ctx, visible, toX, candleSpacing,
      pad.top + priceH + volumeH, volumeH, mVol,
      cfg.candleStyle, volStyle, pal,
      hoveredIndex, pad.left, pad.left + chartW
    );
  }

  // ── Candles (clipped) ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
  ctx.clip();

  drawAllCandles({
    ctx,
    candles,
    liveCandle,
    toX,
    toY,
    style: cfg.candleStyle,
    palette: pal,
    candleSpacing,
    hoveredIndex,
    hoverX,
    scrub: cfg.scrub,
    reveal,
    now_ms,
    padLeft: pad.left,
    chartW,
  });
  ctx.restore();

  // ── Close price line ──
  const closeY = toY(state.displayClose);
  const lastBullish = liveCandle
    ? liveCandle.close >= liveCandle.open
    : candles.length > 0
      ? candles[candles.length - 1].close >= candles[candles.length - 1].open
      : true;
  const closeColor = lastBullish ? pal.bullish : pal.bearish;
  drawClosePrice(ctx, closeY, pad.left, w - pad.right, closeColor, reveal * 0.4);

  // ── Live dot ──
  if (reveal > 0.3) {
    const dotAlpha = (reveal - 0.3) / 0.7;
    const dotColor = lastBullish ? pal.dotUp : pal.dotDown;
    const glowColor = lastBullish ? pal.glowUp : pal.glowDown;
    const lastC = liveCandle ?? candles[candles.length - 1];
    const dotX = lastC ? toX(lastC.time) : w - pad.right;
    drawDot(ctx, dotX, closeY, dotColor, glowColor, pal.bg, cfg.pulse, dotAlpha, now_ms);

    if (cfg.showMomentum && momentum !== "flat" && reveal > 0.6) {
      drawArrows(ctx, dotX, closeY, momentum, pal, (reveal - 0.6) / 0.4, now_ms);
    }

    // Degen particles
    if (cfg.degen) {
      const closes = visible.map((c) => c.close);
      const lb = Math.min(5, closes.length - 1);
      const rd = lb > 0 ? Math.abs(closes[closes.length - 1] - closes[closes.length - 1 - lb]) : 0;
      const swing = valRange > 0 ? Math.min(rd / valRange, 1) : 0;
      const burst = spawnParticles(
        state.particles, momentum, dotX, closeY,
        swing, closeColor, dt, cfg.degen
      );
      if (burst > 0) state.shakeAmplitude = (3 + swing * 4) * burst;
      drawParticles(ctx, state.particles, dt);
    }
  }

  // ── Candle crosshair + tooltip ──
  if (hoveredIndex !== null && cfg.scrub) {
    const hc = allCandles[hoveredIndex];
    if (hc) {
      drawCandleCrosshair(
        ctx, hc, toX(hc.time), pad.top, pad.bottom, h,
        pal, cfg.formatPrice, cfg.formatTime, toY, 1
      );

      const isBull = hc.close >= hc.open;
      const pct = ((hc.close - hc.open) / hc.open * 100).toFixed(2);
      onTooltip({
        visible: true,
        x: toX(hc.time),
        y: pad.top,
        title: cfg.formatTime(hc.time),
        subtitle: `${isBull ? "+" : ""}${pct}%`,
        direction: isBull ? "up" : "down",
        rows: [
          { label: "Open", value: cfg.formatPrice(hc.open), color: pal.fg },
          { label: "High", value: cfg.formatPrice(hc.high), color: pal.bullish },
          { label: "Low", value: cfg.formatPrice(hc.low), color: pal.bearish },
          { label: "Close", value: cfg.formatPrice(hc.close), color: isBull ? pal.bullish : pal.bearish },
          ...(hc.volume !== undefined
            ? [{ label: "Volume", value: cfg.formatVolume(hc.volume), color: pal.fgMuted }]
            : []),
        ],
      });

      if (onHover) {
        onHover({
          time: hc.time,
          open: hc.open,
          high: hc.high,
          low: hc.low,
          close: hc.close,
          volume: hc.volume,
          x: toX(hc.time),
          y: toY(hc.close),
          direction: isBull ? "up" : "down",
        });
      }
    }
  } else {
    onTooltip({ visible: false, x: 0, y: 0, rows: [], title: "", subtitle: "", direction: "neutral" });
    if (onHover && hoverX === null) onHover(null);
  }

  // ── Time axis ──
  if (cfg.showTimeAxis) {
    drawTimeAxis(ctx, pal, leftEdge, rightEdge, cfg.windowSecs, pad.left, chartW, h - pad.bottom + 4, reveal, cfg.formatTime);
  }

  // ── Badge ──
  if (cfg.showBadge && reveal > 0.25) {
    const badgeAlpha = reveal < 0.5 ? (reveal - 0.25) / 0.25 : 1;
    const momColor = momentum === "up" ? pal.bullish : momentum === "down" ? pal.bearish : pal.line;
    drawPriceBadge(ctx, closeY, w - pad.right + 8, cfg.formatPrice(state.displayClose), momColor, pal, badgeAlpha);
  }

  // ── Edge fade ──
  drawEdgeFade(ctx, pad.left, h);

  // Undo shake
  if (cfg.degen && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore();
  }
}

// ─── Line Pipeline ─────────────────────────────────────────────────────────

function runLineFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pad: { top: number; right: number; bottom: number; left: number },
  chartW: number,
  chartH: number,
  data: TickPoint[],
  value: number,
  pal: LiveCandlePalette,
  cfg: EngineConfig,
  state: EngineState,
  hoverX: number | null,
  now_ms: number,
  dt: number,
  onHover: ((data: HoverData | null) => void) | undefined,
  onTooltip: (state: TooltipState) => void
): void {
  const hasData = data.length >= 2;

  // Reveal
  const revealTarget = !cfg.loading && hasData ? 1 : 0;
  state.chartReveal = lerp(
    state.chartReveal,
    revealTarget,
    revealTarget === 1 ? 0.09 : 0.14,
    dt
  );
  if (Math.abs(state.chartReveal - revealTarget) < 0.005)
    state.chartReveal = revealTarget;
  const reveal = state.chartReveal;

  if (!hasData) {
    state.rangeInited = false;
    drawLoading(ctx, pal, pad.left, chartW, pad.top + chartH / 2, chartH, now_ms, cfg.loading);
    drawEdgeFade(ctx, pad.left, h);
    onTooltip({ visible: false, x: 0, y: 0, rows: [], title: "", subtitle: "", direction: "neutral" });
    return;
  }

  // Smooth value
  const prevRange = state.displayMax - state.displayMin || 1;
  const valGap = Math.abs(value - state.displayValue);
  const gapRatio = Math.min(valGap / prevRange, 1);
  const adaptiveSpeed = cfg.lerpSpeed + (1 - gapRatio) * ADAPTIVE_SPEED_BOOST;
  state.displayValue = lerp(state.displayValue, value, adaptiveSpeed, dt);
  if (valGap < prevRange * 0.001) state.displayValue = value;
  const smoothValue = state.displayValue;

  // Window
  const now = Date.now() / 1000;
  const rightEdge = now + cfg.windowSecs * WINDOW_BUFFER;
  const leftEdge = rightEdge - cfg.windowSecs;

  const visible: TickPoint[] = [];
  for (const p of data) {
    if (p.time >= leftEdge - 2 && p.time <= rightEdge) visible.push(p);
  }
  if (visible.length < 2) return;

  // Y range
  const computed = computeLineRange(visible, smoothValue, undefined, cfg.exaggerate);
  if (!state.rangeInited) {
    state.displayMin = computed.min;
    state.displayMax = computed.max;
    state.rangeInited = true;
  } else {
    state.displayMin = lerp(state.displayMin, computed.min, adaptiveSpeed, dt);
    state.displayMax = lerp(state.displayMax, computed.max, adaptiveSpeed, dt);
  }
  const minVal = state.displayMin;
  const maxVal = state.displayMax;
  const valRange = maxVal - minVal || 0.001;

  const toX = (t: number) =>
    pad.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW;
  const toY = (v: number) =>
    pad.top + (1 - (v - minVal) / valRange) * chartH;
  const clampY = (y: number) => clamp(y, pad.top, h - pad.bottom);

  // Momentum
  const momentum = detectMomentum(
    visible.map((p) => p.value)
  );

  // Build screen points with morph
  const centerY = pad.top + chartH / 2;
  const amp = loadingAmplitude(chartH);
  const scroll = now_ms * LOADING_SCROLL_SPEED;

  const morphY =
    reveal < 1
      ? (rawY: number, x: number) => {
          const t = Math.max(0, Math.min(1, (x - pad.left) / chartW));
          const cd = Math.abs(t - 0.5) * 2;
          const lr = Math.max(0, Math.min(1, (reveal - cd * 0.4) / 0.6));
          const baseY = loadingY(t, centerY, amp, scroll);
          return baseY + (rawY - baseY) * lr;
        }
      : (rawY: number) => rawY;

  const pts: [number, number][] = visible.map((p, i) => {
    const x = toX(p.time);
    const y =
      i === visible.length - 1
        ? morphY(clampY(toY(smoothValue)), x)
        : morphY(clampY(toY(p.value)), x);
    return [x, y];
  });
  // Live tip
  const tipX =
    reveal < 1
      ? toX(now) + (pad.left + chartW - toX(now)) * (1 - reveal)
      : toX(now);
  pts.push([tipX, morphY(clampY(toY(smoothValue)), tipX)]);

  if (pts.length < 2) return;

  // Shake
  let shakeX = 0;
  let shakeY = 0;
  if (cfg.degen && state.shakeAmplitude > 0.2) {
    shakeX = (Math.random() - 0.5) * 2 * state.shakeAmplitude;
    shakeY = (Math.random() - 0.5) * 2 * state.shakeAmplitude;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }
  if (cfg.degen) {
    state.shakeAmplitude *= Math.pow(0.002, dt / 1000);
    if (state.shakeAmplitude < 0.2) state.shakeAmplitude = 0;
  }

  // Grid
  const gridAlpha =
    reveal < 0.7 ? Math.pow(Math.max(0, reveal - 0.15) / 0.55, 2) : 1;
  if (cfg.showGrid) {
    drawGrid(
      ctx, pal, pad, w, chartW, chartH, minVal, valRange,
      toY, gridAlpha, cfg.formatPrice, cfg.showPriceAxis
    );
  }

  if (cfg.refs.length > 0) {
    drawReferenceLines(ctx, cfg.refs, toY, pad.left, w - pad.right, pal, reveal);
  }

  // Line + fill
  const breath = loadingBreath(now_ms);
  const lineAlpha = reveal < 1 ? breath + (1 - breath) * reveal : 1;
  const fillAlpha = reveal;
  const strokeColor =
    reveal < 1
      ? blendColors(pal.gridLabel, pal.line, Math.min(1, reveal * 3))
      : pal.line;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
  ctx.clip();
  drawLine(
    ctx, pts, pal, pad.top, pad.bottom, h,
    cfg.showFill, lineAlpha, fillAlpha, strokeColor,
    hoverX, cfg.scrub
  );
  ctx.restore();

  // Dashed price line
  const currentY = clampY(toY(smoothValue));
  const morphedY = reveal < 1 ? centerY + (currentY - centerY) * reveal : currentY;
  drawClosePrice(ctx, morphedY, pad.left, w - pad.right, pal.dashLine, reveal);

  // Live dot
  const lastPt = pts[pts.length - 1];
  if (reveal > 0.3 && lastPt) {
    const dotAlpha = (reveal - 0.3) / 0.7;
    const dotColor = momentum === "up" ? pal.dotUp : momentum === "down" ? pal.dotDown : pal.dotFlat;
    const glowColor = momentum === "up" ? pal.glowUp : momentum === "down" ? pal.glowDown : pal.line;
    drawDot(ctx, lastPt[0], lastPt[1], dotColor, glowColor, pal.bg, cfg.pulse, dotAlpha, now_ms);

    if (cfg.showMomentum && momentum !== "flat" && reveal > 0.6) {
      drawArrows(ctx, lastPt[0], lastPt[1], momentum, pal, (reveal - 0.6) / 0.4, now_ms);
    }

    if (cfg.degen) {
      const vals = visible.map((p) => p.value);
      const lb = Math.min(5, vals.length - 1);
      const rd = lb > 0 ? Math.abs(vals[vals.length - 1] - vals[vals.length - 1 - lb]) : 0;
      const swing = valRange > 0 ? Math.min(rd / valRange, 1) : 0;
      const burst = spawnParticles(state.particles, momentum, lastPt[0], lastPt[1], swing, pal.line, dt, cfg.degen);
      if (burst > 0) state.shakeAmplitude = (3 + swing * 4) * burst;
      drawParticles(ctx, state.particles, dt);
    }
  }

  // Crosshair
  if (cfg.scrub && hoverX !== null && hoverX >= pad.left && hoverX <= w - pad.right) {
    const hoverTime = leftEdge + ((hoverX - pad.left) / chartW) * (rightEdge - leftEdge);
    const hoverVal = interpolateAtTime(visible, hoverTime);
    if (hoverVal !== null) {
      const hy = clampY(toY(hoverVal));
      drawCrosshair(ctx, hoverX, hy, pad.top, pad.bottom, h, pal.crosshairLine, pal.line, 1);

      ctx.save();
      ctx.font = pal.labelFont;
      ctx.textAlign = "center";
      ctx.fillStyle = pal.gridLabel;
      ctx.globalAlpha = 0.8;
      ctx.textBaseline = "bottom";
      ctx.fillText(cfg.formatPrice(hoverVal), hoverX, hy - 10);
      ctx.textBaseline = "top";
      ctx.fillText(cfg.formatTime(hoverTime), hoverX, h - pad.bottom + 4);
      ctx.restore();

      onTooltip({
        visible: true,
        x: hoverX,
        y: pad.top,
        title: cfg.formatTime(hoverTime),
        subtitle: "",
        direction: "neutral",
        rows: [
          { label: "Price", value: cfg.formatPrice(hoverVal), color: pal.line },
        ],
      });

      if (onHover) {
        onHover({
          time: hoverTime,
          value: hoverVal,
          x: hoverX,
          y: hy,
          direction: "neutral",
        });
      }
    }
  } else {
    onTooltip({ visible: false, x: 0, y: 0, rows: [], title: "", subtitle: "", direction: "neutral" });
    if (onHover && hoverX === null) onHover(null);
  }

  // Time axis
  if (cfg.showTimeAxis) {
    drawTimeAxis(ctx, pal, leftEdge, rightEdge, cfg.windowSecs, pad.left, chartW, h - pad.bottom + 4, reveal, cfg.formatTime);
  }

  // Badge
  if (cfg.showBadge && reveal > 0.25) {
    const badgeAlpha = reveal < 0.5 ? (reveal - 0.25) / 0.25 : 1;
    const momColor = momentum === "up" ? pal.bullish : momentum === "down" ? pal.bearish : pal.line;
    drawPriceBadge(ctx, morphedY, w - pad.right + 8, cfg.formatPrice(smoothValue), momColor, pal, badgeAlpha);
  }

  drawEdgeFade(ctx, pad.left, h);

  if (cfg.degen && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore();
  }
}
