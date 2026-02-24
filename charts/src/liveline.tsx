"use client";

/**
 * Liveline — A high-performance canvas-rendered real-time line chart.
 *
 * Architecture inspired by benjitaylor/liveline:
 * - Single <canvas> element, zero DOM per data point
 * - requestAnimationFrame loop (pauses when tab hidden)
 * - Fritsch-Carlson monotone splines (no overshoots)
 * - Frame-rate-independent lerp for all animations
 * - Loading → data morph transition via squiggly baseline
 * - Degen mode: burst particles + chart shake
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useLayoutEffect,
  useMemo,
} from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LivelinePoint {
  time: number; // unix seconds
  value: number;
}

export type Momentum = "up" | "down" | "flat";
export type ThemeMode = "light" | "dark";

export interface LivelinePalette {
  line: string;
  lineWidth: number;
  fillTop: string;
  fillBottom: string;
  gridLine: string;
  gridLabel: string;
  dotFill: string;
  dotStroke: string;
  glowColor: string;
  dashLine: string;
  bg: string;
  bgRgb: [number, number, number];
  labelFont: string;
}

export interface DegenOptions {
  scale?: number;
  downMomentum?: boolean;
}

// ─── Math Utilities ─────────────────────────────────────────────────────────

/** Frame-rate-independent exponential lerp. speed = fraction per 16.67ms. */
function lerp(current: number, target: number, speed: number, dt = 16.67): number {
  const factor = 1 - Math.pow(1 - speed, dt / 16.67);
  return current + (target - current) * factor;
}

/** Fritsch-Carlson monotone cubic spline. No overshoots. */
function drawSpline(ctx: CanvasRenderingContext2D, pts: [number, number][]) {
  if (pts.length < 2) return;
  if (pts.length === 2) {
    ctx.lineTo(pts[1][0], pts[1][1]);
    return;
  }

  const n = pts.length;
  const delta: number[] = new Array(n - 1);
  const h: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = pts[i + 1][0] - pts[i][0];
    delta[i] = h[i] === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / h[i];
  }

  const m: number[] = new Array(n);
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    if (delta[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];
      const s2 = alpha * alpha + beta * beta;
      if (s2 > 9) {
        const s = 3 / Math.sqrt(s2);
        m[i] = s * alpha * delta[i];
        m[i + 1] = s * beta * delta[i];
      }
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const hi = h[i];
    ctx.bezierCurveTo(
      pts[i][0] + hi / 3,
      pts[i][1] + (m[i] * hi) / 3,
      pts[i + 1][0] - hi / 3,
      pts[i + 1][1] - (m[i + 1] * hi) / 3,
      pts[i + 1][0],
      pts[i + 1][1]
    );
  }
}

/** Detect momentum from recent data. */
function detectMomentum(points: LivelinePoint[], lookback = 20): Momentum {
  if (points.length < 5) return "flat";
  const start = Math.max(0, points.length - lookback);
  let min = Infinity, max = -Infinity;
  for (let i = start; i < points.length; i++) {
    const v = points[i].value;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range === 0) return "flat";
  const tailStart = Math.max(start, points.length - 5);
  const delta = points[points.length - 1].value - points[tailStart].value;
  if (delta > range * 0.12) return "up";
  if (delta < -range * 0.12) return "down";
  return "flat";
}

/** Binary search interpolation at time t. */
function interpolateAtTime(points: LivelinePoint[], time: number): number | null {
  if (points.length === 0) return null;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time) return points[points.length - 1].value;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const p1 = points[lo], p2 = points[hi];
  const dt = p2.time - p1.time;
  if (dt === 0) return p1.value;
  return p1.value + ((p2.value - p1.value) * (time - p1.time)) / dt;
}

/** Compute Y range with margin. */
function computeRange(
  visible: LivelinePoint[],
  currentValue: number,
  exaggerate: boolean
): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const p of visible) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }
  if (currentValue < min) min = currentValue;
  if (currentValue > max) max = currentValue;
  const rawRange = max - min;
  const marginFactor = exaggerate ? 0.01 : 0.12;
  const minRange = rawRange * (exaggerate ? 0.02 : 0.1) || (exaggerate ? 0.04 : 0.4);
  if (rawRange < minRange) {
    const mid = (min + max) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  const margin = rawRange * marginFactor;
  return { min: min - margin, max: max + margin };
}

// ─── Loading shape ──────────────────────────────────────────────────────────

const LOADING_AMP_RATIO = 0.07;
const LOADING_SCROLL_SPEED = 0.001;

function loadingY(t: number, centerY: number, amp: number, scroll: number): number {
  return (
    centerY +
    amp *
      (Math.sin(t * 9.4 + scroll) * 0.55 +
        Math.sin(t * 15.7 + scroll * 1.3) * 0.3 +
        Math.sin(t * 4.2 + scroll * 0.7) * 0.15)
  );
}

function loadingBreath(now_ms: number): number {
  return 0.22 + 0.08 * Math.sin((now_ms / 1200) * Math.PI);
}

// ─── Particle System ────────────────────────────────────────────────────────

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; size: number; color: string;
}

interface ParticleState {
  particles: Particle[];
  cooldown: number;
  burstCount: number;
}

function spawnParticles(
  state: ParticleState,
  momentum: Momentum,
  dotX: number,
  dotY: number,
  swingMagnitude: number,
  color: string,
  dt: number,
  options?: DegenOptions
): number {
  state.cooldown = Math.max(0, state.cooldown - dt);
  if (momentum === "flat" || state.cooldown > 0) return 0;
  if (swingMagnitude < 0.08) { state.burstCount = 0; return 0; }
  if (momentum === "down" && !options?.downMomentum) return 0;
  if (state.burstCount >= 3) return 0;

  state.cooldown = 400;
  const scale = options?.scale ?? 1;
  const mag = Math.min(swingMagnitude * 5, 1);
  const falloff = mag > 0.6 ? 1 : [1, 0.6, 0.35][state.burstCount] ?? 0.35;
  state.burstCount++;
  const count = Math.round((12 + mag * 20) * scale * falloff);
  const isUp = momentum === "up";

  for (let i = 0; i < count && state.particles.length < 80; i++) {
    const baseAngle = isUp ? -Math.PI / 2 : Math.PI / 2;
    const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 1.2;
    const speed = (60 + Math.random() * 100) * (1 + mag * 0.8);
    state.particles.push({
      x: dotX + (Math.random() - 0.5) * 24,
      y: dotY + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1, size: (1 + Math.random() * 1.2) * scale * falloff, color,
    });
  }
  return falloff;
}

function drawParticles(ctx: CanvasRenderingContext2D, state: ParticleState, dt: number) {
  if (state.particles.length === 0) return;
  const dtSec = dt / 1000;
  ctx.save();
  let write = 0;
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    p.life -= dtSec;
    if (p.life <= 0) continue;
    p.x += p.vx * dtSec;
    p.y += p.vy * dtSec;
    p.vx *= 0.95;
    p.vy *= 0.95;
    ctx.globalAlpha = p.life * 0.55;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.5 + p.life * 0.5), 0, Math.PI * 2);
    ctx.fill();
    state.particles[write++] = p;
  }
  state.particles.length = write;
  ctx.restore();
}

// ─── Theme ──────────────────────────────────────────────────────────────────

function parseColorRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [128, 128, 128];
}

function resolveTheme(color: string, mode: ThemeMode): LivelinePalette {
  const [r, g, b] = parseColorRgb(color);
  const isDark = mode === "dark";
  const rgba = (rr: number, gg: number, bb: number, a: number) =>
    `rgba(${rr},${gg},${bb},${a})`;

  return {
    line: color,
    lineWidth: 2,
    fillTop: rgba(r, g, b, isDark ? 0.12 : 0.08),
    fillBottom: rgba(r, g, b, 0),
    gridLine: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
    gridLabel: isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
    dotFill: color,
    dotStroke: isDark ? "#18181b" : "#ffffff",
    glowColor: rgba(r, g, b, 0.35),
    dashLine: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    bg: isDark ? "#0a0a0a" : "#ffffff",
    bgRgb: isDark ? [10, 10, 10] : [255, 255, 255],
    labelFont: '11px "SF Mono", Menlo, Consolas, monospace',
  };
}

// ─── Engine (rAF draw loop) ─────────────────────────────────────────────────

const MAX_DELTA_MS = 50;
const ADAPTIVE_SPEED_BOOST = 0.2;
const FADE_EDGE_WIDTH = 40;
const WINDOW_BUFFER = 0.05;
const PULSE_INTERVAL = 1500;
const PULSE_DURATION = 900;

interface EngineState {
  displayValue: number;
  displayMin: number;
  displayMax: number;
  rangeInited: boolean;
  chartReveal: number;
  shakeAmplitude: number;
  particles: ParticleState;
  lastFrame: number;
}

function createEngineState(value: number): EngineState {
  return {
    displayValue: value,
    displayMin: 0,
    displayMax: 0,
    rangeInited: false,
    chartReveal: 0,
    shakeAmplitude: 0,
    particles: { particles: [], cooldown: 0, burstCount: 0 },
    lastFrame: 0,
  };
}

function runFrame(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  data: LivelinePoint[],
  value: number,
  palette: LivelinePalette,
  state: EngineState,
  opts: {
    windowSecs: number;
    lerpSpeed: number;
    showGrid: boolean;
    showFill: boolean;
    scrub: boolean;
    exaggerate: boolean;
    loading: boolean;
    paused: boolean;
    degen?: DegenOptions;
    pulse: boolean;
    momentum: boolean;
    formatValue: (v: number) => string;
    formatTime: (t: number) => string;
    hoverX: number | null;
  }
) {
  const now_ms = performance.now();
  const dt = state.lastFrame ? Math.min(now_ms - state.lastFrame, MAX_DELTA_MS) : 16.67;
  state.lastFrame = now_ms;

  const dpr = window.devicePixelRatio || 1;
  const tw = Math.round(w * dpr);
  const th = Math.round(h * dpr);
  if (ctx.canvas.width !== tw || ctx.canvas.height !== th) {
    ctx.canvas.width = tw;
    ctx.canvas.height = th;
    ctx.canvas.style.width = `${w}px`;
    ctx.canvas.style.height = `${h}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { top: 12, right: 80, bottom: 28, left: 12 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const hasData = data.length >= 2;

  // Chart reveal
  const revealTarget = !opts.loading && hasData ? 1 : 0;
  state.chartReveal = lerp(state.chartReveal, revealTarget, revealTarget === 1 ? 0.09 : 0.14, dt);
  if (Math.abs(state.chartReveal - revealTarget) < 0.005) state.chartReveal = revealTarget;
  const reveal = state.chartReveal;

  if (!hasData) {
    state.rangeInited = false;
    // Draw loading squiggly
    const scroll = now_ms * LOADING_SCROLL_SPEED;
    const breath = loadingBreath(now_ms);
    const centerY = pad.top + chartH / 2;
    const amp = chartH * LOADING_AMP_RATIO;
    const numPts = 32;
    const pts: [number, number][] = [];
    for (let i = 0; i <= numPts; i++) {
      const t = i / numPts;
      pts.push([pad.left + t * chartW, loadingY(t, centerY, amp, scroll)]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    drawSpline(ctx, pts);
    ctx.strokeStyle = opts.loading ? palette.line : palette.gridLabel;
    ctx.lineWidth = palette.lineWidth;
    ctx.globalAlpha = breath;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Fade left edge
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const fg = ctx.createLinearGradient(pad.left, 0, pad.left + FADE_EDGE_WIDTH, 0);
    fg.addColorStop(0, "rgba(0,0,0,1)");
    fg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, pad.left + FADE_EDGE_WIDTH, h);
    ctx.restore();

    if (!opts.loading) {
      // Empty state text
      ctx.save();
      ctx.font = "400 12px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = palette.gridLabel;
      ctx.fillText("No data", pad.left + chartW / 2, pad.top + chartH / 2);
      ctx.restore();
    }
    return;
  }

  // Smooth value
  const prevRange = state.displayMax - state.displayMin || 1;
  const valGap = Math.abs(value - state.displayValue);
  const gapRatio = Math.min(valGap / prevRange, 1);
  const adaptiveSpeed = opts.lerpSpeed + (1 - gapRatio) * ADAPTIVE_SPEED_BOOST;
  state.displayValue = lerp(state.displayValue, value, adaptiveSpeed, dt);
  if (valGap < prevRange * 0.001) state.displayValue = value;
  const smoothValue = state.displayValue;

  // Visible window
  const now = Date.now() / 1000;
  const rightEdge = now + opts.windowSecs * WINDOW_BUFFER;
  const leftEdge = rightEdge - opts.windowSecs;
  const visible: LivelinePoint[] = [];
  for (const p of data) {
    if (p.time >= leftEdge - 2 && p.time <= rightEdge) visible.push(p);
  }
  if (visible.length < 2) return;

  // Y range
  const computed = computeRange(visible, smoothValue, opts.exaggerate);
  if (!state.rangeInited) {
    state.displayMin = computed.min;
    state.displayMax = computed.max;
    state.rangeInited = true;
  } else {
    state.displayMin = lerp(state.displayMin, computed.min, adaptiveSpeed, dt);
    state.displayMax = lerp(state.displayMax, computed.max, adaptiveSpeed, dt);
    const pxThreshold = 0.5 * prevRange / chartH || 0.001;
    if (Math.abs(state.displayMin - computed.min) < pxThreshold) state.displayMin = computed.min;
    if (Math.abs(state.displayMax - computed.max) < pxThreshold) state.displayMax = computed.max;
  }

  const minVal = state.displayMin;
  const maxVal = state.displayMax;
  const valRange = (maxVal - minVal) || 0.001;

  const toX = (t: number) => pad.left + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW;
  const toY = (v: number) => pad.top + (1 - (v - minVal) / valRange) * chartH;
  const clampY = (y: number) => Math.max(pad.top, Math.min(h - pad.bottom, y));

  // Shake
  let shakeX = 0, shakeY = 0;
  if (opts.degen && state.shakeAmplitude > 0.2) {
    shakeX = (Math.random() - 0.5) * 2 * state.shakeAmplitude;
    shakeY = (Math.random() - 0.5) * 2 * state.shakeAmplitude;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }
  if (opts.degen) {
    state.shakeAmplitude *= Math.pow(0.002, dt / 1000);
    if (state.shakeAmplitude < 0.2) state.shakeAmplitude = 0;
  }

  // Build screen points with morph
  const centerY = pad.top + chartH / 2;
  const amp = chartH * LOADING_AMP_RATIO;
  const scroll = now_ms * LOADING_SCROLL_SPEED;

  const morphY = reveal < 1
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
    const y = i === visible.length - 1
      ? morphY(clampY(toY(smoothValue)), x)
      : morphY(clampY(toY(p.value)), x);
    return [x, y];
  });
  // Live tip
  const tipX = reveal < 1
    ? toX(now) + (pad.left + chartW - toX(now)) * (1 - reveal)
    : toX(now);
  pts.push([tipX, morphY(clampY(toY(smoothValue)), tipX)]);

  if (pts.length < 2) return;

  // Grid
  if (opts.showGrid && reveal > 0.15) {
    const gridAlpha = reveal < 0.7 ? Math.pow((reveal - 0.15) / 0.55, 2) : 1;
    ctx.save();
    ctx.globalAlpha = gridAlpha;
    ctx.strokeStyle = palette.gridLine;
    ctx.lineWidth = 1;
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = minVal + (valRange * i) / ticks;
      const y = toY(v);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      // Label
      ctx.font = palette.labelFont;
      ctx.fillStyle = palette.gridLabel;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.formatValue(v), w - pad.right + 6, y);
    }
    ctx.restore();
  }

  // Fill + line
  const breath = loadingBreath(now_ms);
  const lineAlpha = reveal < 1 ? breath + (1 - breath) * reveal : 1;
  const fillAlpha = reveal;
  const strokeColor = reveal < 1
    ? blendColors(palette.gridLabel, palette.line, Math.min(1, reveal * 3))
    : palette.line;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
  ctx.clip();

  // Scrub dimming
  const hoverX = opts.hoverX;
  const isScrubbing = hoverX !== null && opts.scrub;

  if (isScrubbing && hoverX !== null) {
    // Bright left of hover
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, hoverX, h);
    ctx.clip();
    renderCurve(ctx, pts, pad, h, palette, opts.showFill, lineAlpha, fillAlpha, strokeColor);
    ctx.restore();

    // Dimmed right of hover
    ctx.save();
    ctx.beginPath();
    ctx.rect(hoverX, 0, w - hoverX, h);
    ctx.clip();
    ctx.globalAlpha = 0.4;
    renderCurve(ctx, pts, pad, h, palette, opts.showFill, lineAlpha, fillAlpha, strokeColor);
    ctx.restore();
  } else {
    renderCurve(ctx, pts, pad, h, palette, opts.showFill, lineAlpha, fillAlpha, strokeColor);
  }
  ctx.restore();

  // Dash line
  const realCurrentY = clampY(toY(smoothValue));
  const currentY = reveal < 1 ? centerY + (realCurrentY - centerY) * reveal : realCurrentY;
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = palette.dashLine;
  ctx.lineWidth = 1;
  ctx.globalAlpha = reveal;
  ctx.beginPath();
  ctx.moveTo(pad.left, currentY);
  ctx.lineTo(w - pad.right, currentY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Live dot
  const lastPt = pts[pts.length - 1];
  if (reveal > 0.3) {
    const dotAlpha = (reveal - 0.3) / 0.7;
    ctx.save();
    ctx.globalAlpha = dotAlpha;

    // Pulse ring
    if (opts.pulse && reveal > 0.6) {
      const t = (now_ms % PULSE_INTERVAL) / PULSE_DURATION;
      if (t < 1) {
        ctx.beginPath();
        ctx.arc(lastPt[0], lastPt[1], 9 + t * 12, 0, Math.PI * 2);
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = dotAlpha * 0.35 * (1 - t);
        ctx.stroke();
      }
    }

    // Outer circle
    ctx.globalAlpha = dotAlpha;
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 6.5, 0, Math.PI * 2);
    ctx.fillStyle = palette.dotStroke;
    ctx.shadowColor = palette.glowColor;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner dot
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], 3.5, 0, Math.PI * 2);
    ctx.fillStyle = palette.dotFill;
    ctx.fill();
    ctx.restore();
  }

  // Momentum arrows
  if (opts.momentum && reveal > 0.6) {
    const momentum = detectMomentum(visible);
    if (momentum !== "flat") {
      const isUp = momentum === "up";
      const baseX = lastPt[0] + 19;
      const dir = isUp ? -1 : 1;
      const cycle = (now_ms % 1400) / 1400;
      ctx.save();
      ctx.strokeStyle = palette.gridLabel;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < 2; i++) {
        const start = i * 0.2;
        const dur = 0.35;
        const localT = cycle - start;
        const wave = localT >= 0 && localT < dur ? Math.sin((localT / dur) * Math.PI) : 0;
        ctx.globalAlpha = (0.3 + 0.7 * wave) * ((reveal - 0.6) / 0.4);
        const cy = lastPt[1] + dir * (i * 8 - 4) + dir * 3;
        ctx.beginPath();
        ctx.moveTo(baseX - 5, cy - dir * 3.5);
        ctx.lineTo(baseX, cy);
        ctx.lineTo(baseX + 5, cy - dir * 3.5);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Degen particles
    if (opts.degen) {
      const lookback = Math.min(5, visible.length - 1);
      const recentDelta = lookback > 0
        ? Math.abs(visible[visible.length - 1].value - visible[visible.length - 1 - lookback].value)
        : 0;
      const swing = valRange > 0 ? Math.min(recentDelta / valRange, 1) : 0;
      const burst = spawnParticles(
        state.particles, detectMomentum(visible), lastPt[0], lastPt[1],
        swing, palette.line, dt, opts.degen
      );
      if (burst > 0) state.shakeAmplitude = (3 + swing * 4) * burst;
      drawParticles(ctx, state.particles, dt);
    }
  }

  // Crosshair on hover
  if (isScrubbing && hoverX !== null && hoverX >= pad.left && hoverX <= w - pad.right) {
    const hoverTime = leftEdge + ((hoverX - pad.left) / chartW) * (rightEdge - leftEdge);
    const hoverVal = interpolateAtTime(visible, hoverTime);
    if (hoverVal !== null) {
      const hy = clampY(toY(hoverVal));

      // Vertical line
      ctx.save();
      ctx.strokeStyle = palette.gridLine;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(hoverX, pad.top);
      ctx.lineTo(hoverX, h - pad.bottom);
      ctx.stroke();
      ctx.restore();

      // Dot on line
      ctx.save();
      ctx.beginPath();
      ctx.arc(hoverX, hy, 4, 0, Math.PI * 2);
      ctx.fillStyle = palette.line;
      ctx.fill();
      ctx.restore();

      // Value label
      ctx.save();
      ctx.font = palette.labelFont;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = palette.gridLabel;
      ctx.globalAlpha = 0.8;
      ctx.fillText(opts.formatValue(hoverVal), hoverX, hy - 10);

      // Time label
      ctx.textBaseline = "top";
      ctx.fillText(opts.formatTime(hoverTime), hoverX, h - pad.bottom + 4);
      ctx.restore();
    }
  }

  // Fade left edge
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const fadeGrad = ctx.createLinearGradient(pad.left, 0, pad.left + FADE_EDGE_WIDTH, 0);
  fadeGrad.addColorStop(0, "rgba(0,0,0,1)");
  fadeGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fadeGrad;
  ctx.fillRect(0, 0, pad.left + FADE_EDGE_WIDTH, h);
  ctx.restore();

  // Badge (current price label)
  if (reveal > 0.25) {
    const badgeAlpha = reveal < 0.5 ? (reveal - 0.25) / 0.25 : 1;
    const badgeY = reveal < 1
      ? centerY + (realCurrentY - centerY) * reveal
      : realCurrentY;
    const text = opts.formatValue(smoothValue);
    ctx.save();
    ctx.font = palette.labelFont;
    const tw = ctx.measureText(text).width;
    const bx = w - pad.right + 8;
    const by = badgeY;
    const bw = tw + 16;
    const bh = 22;

    ctx.globalAlpha = badgeAlpha;

    // Momentum color
    const mom = detectMomentum(visible);
    const momColor = mom === "up" ? "#22c55e" : mom === "down" ? "#ef4444" : palette.line;

    // Pill background
    ctx.fillStyle = momColor;
    ctx.beginPath();
    ctx.roundRect(bx, by - bh / 2, bw, bh, 4);
    ctx.fill();

    // Text
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, bx + bw / 2, by);
    ctx.restore();
  }

  // Undo shake
  if (opts.degen && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore();
  }
}

// ─── Render helpers ─────────────────────────────────────────────────────────

function renderCurve(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  pad: { top: number; bottom: number },
  h: number,
  palette: LivelinePalette,
  showFill: boolean,
  lineAlpha: number,
  fillAlpha: number,
  strokeColor: string
) {
  const baseAlpha = ctx.globalAlpha;

  if (showFill && fillAlpha > 0.01) {
    ctx.globalAlpha = baseAlpha * fillAlpha;
    const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    grad.addColorStop(0, palette.fillTop);
    grad.addColorStop(1, palette.fillBottom);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h - pad.bottom);
    ctx.lineTo(pts[0][0], pts[0][1]);
    drawSpline(ctx, pts);
    ctx.lineTo(pts[pts.length - 1][0], h - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  ctx.globalAlpha = baseAlpha * lineAlpha;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  drawSpline(ctx, pts);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = palette.lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;
}

function blendColors(c1: string, c2: string, t: number): string {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const parse = (c: string): [number, number, number, number] => {
    const hex = c.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
    if (m) return [+m[1], +m[2], +m[3], m[4] ? +m[4] : 1];
    return [128, 128, 128, 1];
  };
  const [r1, g1, b1, a1] = parse(c1);
  const [r2, g2, b2, a2] = parse(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  const a = a1 + (a2 - a1) * t;
  return a >= 0.995 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

// ─── Public Component ───────────────────────────────────────────────────────

export interface LivelineHandle {
  push(point: LivelinePoint): void;
  setData(points: LivelinePoint[]): void;
}

export interface LivelineProps {
  data: LivelinePoint[];
  value: number;
  theme?: ThemeMode;
  color?: string;
  window?: number;
  grid?: boolean;
  fill?: boolean;
  momentum?: boolean;
  pulse?: boolean;
  scrub?: boolean;
  exaggerate?: boolean;
  loading?: boolean;
  paused?: boolean;
  degen?: boolean | DegenOptions;
  lerpSpeed?: number;
  formatValue?: (v: number) => string;
  formatTime?: (t: number) => string;
  className?: string;
  style?: React.CSSProperties;
}

export const Liveline = forwardRef<LivelineHandle, LivelineProps>(
  function Liveline(
    {
      data: initialData,
      value: propValue,
      theme = "dark",
      color = "#3b82f6",
      window: windowSecs = 30,
      grid = true,
      fill = true,
      momentum = true,
      pulse = true,
      scrub = true,
      exaggerate = false,
      loading = false,
      paused = false,
      degen,
      lerpSpeed = 0.08,
      formatValue = (v) => v.toFixed(2),
      formatTime = (t) => {
        const d = new Date(t * 1000);
        return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
      },
      className,
      style,
    },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [data, setData] = useState(initialData);
    const [value, setValue] = useState(propValue);
    const sizeRef = useRef({ w: 0, h: 0 });
    const hoverXRef = useRef<number | null>(null);
    const engineRef = useRef<EngineState>(createEngineState(propValue));
    const configRef = useRef({
      windowSecs, lerpSpeed, showGrid: grid, showFill: fill, scrub,
      exaggerate, loading, paused, degen: degen as DegenOptions | undefined,
      pulse, momentum, formatValue, formatTime,
    });

    const palette = useMemo(() => resolveTheme(color, theme), [color, theme]);

    // Sync props
    useEffect(() => { setData(initialData); }, [initialData]);
    useEffect(() => { setValue(propValue); }, [propValue]);
    useEffect(() => {
      configRef.current = {
        windowSecs, lerpSpeed, showGrid: grid, showFill: fill, scrub,
        exaggerate, loading, paused,
        degen: degen === true ? {} : degen === false ? undefined : degen,
        pulse, momentum, formatValue, formatTime,
      };
    }, [windowSecs, lerpSpeed, grid, fill, scrub, exaggerate, loading, paused, degen, pulse, momentum, formatValue, formatTime]);

    // Imperative handle
    useImperativeHandle(ref, () => ({
      push(point: LivelinePoint) {
        setData((prev) => {
          const next = [...prev, point];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
        setValue(point.value);
      },
      setData(points: LivelinePoint[]) {
        setData(points);
        if (points.length > 0) setValue(points[points.length - 1].value);
      },
    }));

    // ResizeObserver
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const ro = new ResizeObserver((entries) => {
        const e = entries[0];
        if (e) sizeRef.current = { w: e.contentRect.width, h: e.contentRect.height };
      });
      ro.observe(container);
      const rect = container.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      return () => ro.disconnect();
    }, []);

    // Mouse events
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const onMove = (e: MouseEvent) => {
        const rect = container.getBoundingClientRect();
        hoverXRef.current = e.clientX - rect.left;
      };
      const onLeave = () => { hoverXRef.current = null; };
      container.addEventListener("mousemove", onMove);
      container.addEventListener("mouseleave", onLeave);
      return () => {
        container.removeEventListener("mousemove", onMove);
        container.removeEventListener("mouseleave", onLeave);
      };
    }, []);

    // rAF loop
    const dataRef = useRef(data);
    const valueRef = useRef(value);
    dataRef.current = data;
    valueRef.current = value;

    const draw = useCallback(() => {
      if (document.hidden) return;
      const canvas = canvasRef.current;
      const { w, h } = sizeRef.current;
      if (!canvas || w === 0 || h === 0) {
        requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) { requestAnimationFrame(draw); return; }

      runFrame(ctx, w, h, dataRef.current, valueRef.current, palette, engineRef.current, {
        ...configRef.current,
        hoverX: hoverXRef.current,
      });
      requestAnimationFrame(draw);
    }, [palette]);

    useEffect(() => {
      const raf = requestAnimationFrame(draw);
      return () => cancelAnimationFrame(raf);
    }, [draw]);

    // Visibility change
    useEffect(() => {
      const onVis = () => { if (!document.hidden) requestAnimationFrame(draw); };
      document.addEventListener("visibilitychange", onVis);
      return () => document.removeEventListener("visibilitychange", onVis);
    }, [draw]);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ width: "100%", height: "100%", position: "relative", ...style }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", cursor: scrub ? "crosshair" : "default" }}
        />
      </div>
    );
  }
);

export default Liveline;
