import type { Momentum, OHLCPoint, TickPoint } from "./types";

// ─── Lerp ──────────────────────────────────────────────────────────────────

/** Frame-rate-independent exponential lerp. speed = fraction per 16.67ms. */
export function lerp(
  current: number,
  target: number,
  speed: number,
  dt = 16.67
): number {
  const factor = 1 - Math.pow(1 - speed, dt / 16.67);
  return current + (target - current) * factor;
}

// ─── Spline ────────────────────────────────────────────────────────────────

/** Fritsch-Carlson monotone cubic spline. Guaranteed no overshoots. */
export function drawSpline(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][]
): void {
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
    m[i] =
      delta[i - 1] * delta[i] <= 0 ? 0 : (delta[i - 1] + delta[i]) / 2;
  }

  // Fritsch-Carlson constraint: alpha² + beta² ≤ 9
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

// ─── Interpolation ─────────────────────────────────────────────────────────

/** Binary search interpolation at a given time. */
export function interpolateAtTime(
  points: TickPoint[],
  time: number
): number | null {
  if (points.length === 0) return null;
  if (time <= points[0].time) return points[0].value;
  if (time >= points[points.length - 1].time)
    return points[points.length - 1].value;

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= time) lo = mid;
    else hi = mid;
  }
  const p1 = points[lo];
  const p2 = points[hi];
  const dt = p2.time - p1.time;
  if (dt === 0) return p1.value;
  return p1.value + ((p2.value - p1.value) * (time - p1.time)) / dt;
}

/** Binary search to find the candle nearest to a given time. */
export function candleAtTime(
  candles: OHLCPoint[],
  time: number
): number {
  if (candles.length === 0) return -1;
  let lo = 0;
  let hi = candles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  // Pick nearest between lo and lo-1
  if (lo > 0) {
    const dLo = Math.abs(candles[lo].time - time);
    const dPrev = Math.abs(candles[lo - 1].time - time);
    if (dPrev < dLo) return lo - 1;
  }
  return lo;
}

// ─── Momentum ──────────────────────────────────────────────────────────────

export function detectMomentum(
  values: number[],
  lookback = 20
): Momentum {
  if (values.length < 5) return "flat";
  const start = Math.max(0, values.length - lookback);
  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const range = max - min;
  if (range === 0) return "flat";

  const tailStart = Math.max(start, values.length - 5);
  const delta = values[values.length - 1] - values[tailStart];
  if (delta > range * 0.12) return "up";
  if (delta < -range * 0.12) return "down";
  return "flat";
}

export function detectCandleMomentum(
  candles: OHLCPoint[],
  lookback = 20
): Momentum {
  return detectMomentum(
    candles.map((c) => c.close),
    lookback
  );
}

// ─── Range ─────────────────────────────────────────────────────────────────

export function computeCandleRange(
  candles: OHLCPoint[],
  liveCandle?: OHLCPoint,
  exaggerate?: boolean
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of candles) {
    if (c.low < lo) lo = c.low;
    if (c.high > hi) hi = c.high;
  }
  if (liveCandle) {
    if (liveCandle.low < lo) lo = liveCandle.low;
    if (liveCandle.high > hi) hi = liveCandle.high;
  }
  const raw = hi - lo;
  const margin = raw * (exaggerate ? 0.02 : 0.08);
  const minRange = raw * (exaggerate ? 0.01 : 0.06) || 0.4;
  if (raw < minRange) {
    const mid = (lo + hi) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  return { min: lo - margin, max: hi + margin };
}

export function computeLineRange(
  visible: TickPoint[],
  currentValue: number,
  refValue?: number,
  exaggerate?: boolean
): { min: number; max: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of visible) {
    if (p.value < lo) lo = p.value;
    if (p.value > hi) hi = p.value;
  }
  if (currentValue < lo) lo = currentValue;
  if (currentValue > hi) hi = currentValue;
  if (refValue !== undefined) {
    if (refValue < lo) lo = refValue;
    if (refValue > hi) hi = refValue;
  }
  const raw = hi - lo;
  const marginFactor = exaggerate ? 0.01 : 0.12;
  const minRange =
    raw * (exaggerate ? 0.02 : 0.1) || (exaggerate ? 0.04 : 0.4);
  if (raw < minRange) {
    const mid = (lo + hi) / 2;
    return { min: mid - minRange / 2, max: mid + minRange / 2 };
  }
  const margin = raw * marginFactor;
  return { min: lo - margin, max: hi + margin };
}

// ─── Time Intervals ────────────────────────────────────────────────────────

export function niceTimeInterval(windowSecs: number): number {
  if (windowSecs <= 15) return 2;
  if (windowSecs <= 30) return 5;
  if (windowSecs <= 60) return 10;
  if (windowSecs <= 120) return 15;
  if (windowSecs <= 300) return 30;
  if (windowSecs <= 600) return 60;
  if (windowSecs <= 1800) return 300;
  if (windowSecs <= 3600) return 600;
  if (windowSecs <= 14400) return 1800;
  if (windowSecs <= 43200) return 3600;
  if (windowSecs <= 86400) return 7200;
  if (windowSecs <= 604800) return 86400;
  return 604800;
}

// ─── Loading Shape ─────────────────────────────────────────────────────────

const LOADING_AMP_RATIO = 0.07;
export const LOADING_SCROLL_SPEED = 0.001;

export function loadingY(
  t: number,
  centerY: number,
  amp: number,
  scroll: number
): number {
  return (
    centerY +
    amp *
      (Math.sin(t * 9.4 + scroll) * 0.55 +
        Math.sin(t * 15.7 + scroll * 1.3) * 0.3 +
        Math.sin(t * 4.2 + scroll * 0.7) * 0.15)
  );
}

export function loadingBreath(now_ms: number): number {
  return 0.22 + 0.08 * Math.sin((now_ms / 1200) * Math.PI);
}

export function loadingAmplitude(chartH: number): number {
  return chartH * LOADING_AMP_RATIO;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Snap to nearest half-pixel for crisp 1px lines. */
export function snap(v: number): number {
  return Math.round(v) + 0.5;
}

export function maxVolume(candles: OHLCPoint[]): number {
  let max = 0;
  for (const c of candles) {
    if (c.volume !== undefined && c.volume > max) max = c.volume;
  }
  return max || 1;
}
