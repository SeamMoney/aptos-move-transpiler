import type {
  LiveCandlePalette,
  OHLCPoint,
  Particle,
  ParticleState,
  ReferenceLine,
  ResolvedCandleStyle,
  ResolvedVolumeStyle,
  TickPoint,
  Momentum,
  DegenOptions,
  HoverData,
  TooltipRow,
} from "./types";
import {
  drawSpline,
  loadingY,
  loadingBreath,
  loadingAmplitude,
  LOADING_SCROLL_SPEED,
  niceTimeInterval,
  snap,
  clamp,
  interpolateAtTime,
  candleAtTime,
  detectMomentum,
  detectCandleMomentum,
  maxVolume,
} from "./math";
import { blendColors } from "./theme";
import {
  drawAllCandles,
  drawClosePrice,
  drawPriceBadge,
  type DrawCandlesOpts,
} from "./candles";

// ─── Constants ─────────────────────────────────────────────────────────────

const FADE_EDGE_WIDTH = 40;
const PULSE_INTERVAL = 1500;
const PULSE_DURATION = 900;

// ─── Grid ──────────────────────────────────────────────────────────────────

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  palette: LiveCandlePalette,
  pad: { top: number; right: number; bottom: number; left: number },
  w: number,
  chartW: number,
  chartH: number,
  minVal: number,
  valRange: number,
  toY: (v: number) => number,
  alpha: number,
  formatPrice: (v: number) => string,
  showPriceAxis: boolean
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const v = minVal + (valRange * i) / ticks;
    const y = snap(toY(v));

    // Grid line
    ctx.strokeStyle = palette.gridLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    // Price label
    if (showPriceAxis) {
      ctx.font = palette.labelFont;
      ctx.fillStyle = palette.gridLabel;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formatPrice(v), w - pad.right + 6, y);
    }
  }
  ctx.restore();
}

// ─── Volume Bars ───────────────────────────────────────────────────────────

export function drawVolumeBars(
  ctx: CanvasRenderingContext2D,
  candles: OHLCPoint[],
  liveCandle: OHLCPoint | undefined,
  toX: (t: number) => number,
  candleSpacing: number,
  palette: LiveCandlePalette,
  volumeStyle: ResolvedVolumeStyle,
  priceAreaBottom: number,
  volumeH: number,
  alpha: number
): void {
  if (volumeH <= 0 || alpha <= 0) return;
  const all = liveCandle ? [...candles, liveCandle] : candles;
  const mVol = maxVolume(all);

  ctx.save();
  ctx.globalAlpha = alpha * volumeStyle.opacity;

  const barW = Math.max(1, candleSpacing * 0.5);
  const baseY = priceAreaBottom + volumeH;

  for (const c of all) {
    if (c.volume === undefined || c.volume <= 0) continue;
    const cx = toX(c.time);
    const barH = (c.volume / mVol) * volumeH;
    const isBullish = c.close >= c.open;
    ctx.fillStyle = isBullish ? palette.volumeUp : palette.volumeDown;

    const r = Math.min(volumeStyle.radius, barW / 2, barH / 2);
    const x = cx - barW / 2;
    const y = baseY - barH;
    if (r > 0 && barH > 2) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + barW - r, y);
      ctx.arcTo(x + barW, y, x + barW, y + r, r);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barW, barH);
    }
  }
  ctx.restore();
}

// ─── Line + Fill ───────────────────────────────────────────────────────────

export function drawLine(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  palette: LiveCandlePalette,
  padTop: number,
  padBottom: number,
  h: number,
  showFill: boolean,
  lineAlpha: number,
  fillAlpha: number,
  strokeColor: string,
  hoverX: number | null,
  scrub: boolean
): void {
  if (pts.length < 2) return;

  ctx.save();

  if (scrub && hoverX !== null) {
    // Bright left of hover
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, hoverX, h);
    ctx.clip();
    renderCurve(ctx, pts, padTop, padBottom, h, palette, showFill, lineAlpha, fillAlpha, strokeColor);
    ctx.restore();

    // Dimmed right
    ctx.save();
    ctx.beginPath();
    ctx.rect(hoverX, 0, ctx.canvas.width, h);
    ctx.clip();
    ctx.globalAlpha = 0.35;
    renderCurve(ctx, pts, padTop, padBottom, h, palette, showFill, lineAlpha, fillAlpha, strokeColor);
    ctx.restore();
  } else {
    renderCurve(ctx, pts, padTop, padBottom, h, palette, showFill, lineAlpha, fillAlpha, strokeColor);
  }

  ctx.restore();
}

function renderCurve(
  ctx: CanvasRenderingContext2D,
  pts: [number, number][],
  padTop: number,
  padBottom: number,
  h: number,
  palette: LiveCandlePalette,
  showFill: boolean,
  lineAlpha: number,
  fillAlpha: number,
  strokeColor: string
): void {
  const baseAlpha = ctx.globalAlpha;

  if (showFill && fillAlpha > 0.01) {
    ctx.globalAlpha = baseAlpha * fillAlpha;
    const grad = ctx.createLinearGradient(0, padTop, 0, h - padBottom);
    grad.addColorStop(0, palette.fillTop);
    grad.addColorStop(1, palette.fillBottom);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h - padBottom);
    ctx.lineTo(pts[0][0], pts[0][1]);
    drawSpline(ctx, pts);
    ctx.lineTo(pts[pts.length - 1][0], h - padBottom);
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

// ─── Live Dot + Pulse ──────────────────────────────────────────────────────

export function drawDot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  glowColor: string,
  dotStroke: string,
  pulse: boolean,
  alpha: number,
  now_ms: number
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Pulse ring
  if (pulse) {
    const t = (now_ms % PULSE_INTERVAL) / PULSE_DURATION;
    if (t < 1) {
      ctx.beginPath();
      ctx.arc(x, y, 9 + t * 12, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = alpha * 0.35 * (1 - t);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }
  }

  // Outer circle
  ctx.beginPath();
  ctx.arc(x, y, 6.5, 0, Math.PI * 2);
  ctx.fillStyle = dotStroke;
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Inner
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ─── Momentum Arrows ───────────────────────────────────────────────────────

export function drawArrows(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  momentum: Momentum,
  palette: LiveCandlePalette,
  alpha: number,
  now_ms: number
): void {
  if (momentum === "flat" || alpha <= 0) return;
  const isUp = momentum === "up";
  const dir = isUp ? -1 : 1;
  const cycle = (now_ms % 1400) / 1400;
  const baseX = x + 19;

  ctx.save();
  ctx.strokeStyle = palette.gridLabel;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (let i = 0; i < 2; i++) {
    const start = i * 0.2;
    const dur = 0.35;
    const localT = cycle - start;
    const wave =
      localT >= 0 && localT < dur
        ? Math.sin((localT / dur) * Math.PI)
        : 0;
    ctx.globalAlpha = (0.3 + 0.7 * wave) * alpha;
    const cy = y + dir * (i * 8 - 4) + dir * 3;
    ctx.beginPath();
    ctx.moveTo(baseX - 5, cy - dir * 3.5);
    ctx.lineTo(baseX, cy);
    ctx.lineTo(baseX + 5, cy - dir * 3.5);
    ctx.stroke();
  }
  ctx.restore();
}

// ─── Crosshair (canvas) ───────────────────────────────────────────────────

export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  padTop: number,
  padBottom: number,
  h: number,
  color: string,
  dotColor: string,
  alpha: number
): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Vertical line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(snap(x), padTop);
  ctx.lineTo(snap(x), h - padBottom);
  ctx.stroke();

  // Dot on line
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();

  ctx.restore();
}

// ─── Loading State ─────────────────────────────────────────────────────────

export function drawLoading(
  ctx: CanvasRenderingContext2D,
  palette: LiveCandlePalette,
  padLeft: number,
  chartW: number,
  centerY: number,
  chartH: number,
  now_ms: number,
  isLoading: boolean
): void {
  const scroll = now_ms * LOADING_SCROLL_SPEED;
  const breath = loadingBreath(now_ms);
  const amp = loadingAmplitude(chartH);
  const pts: [number, number][] = [];
  const numPts = 32;

  for (let i = 0; i <= numPts; i++) {
    const t = i / numPts;
    pts.push([padLeft + t * chartW, loadingY(t, centerY, amp, scroll)]);
  }

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  drawSpline(ctx, pts);
  ctx.strokeStyle = isLoading ? palette.line : palette.gridLabel;
  ctx.lineWidth = 2;
  ctx.globalAlpha = breath;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;

  if (!isLoading) {
    // Empty state text
    ctx.save();
    ctx.font = '400 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = palette.gridLabel;
    ctx.fillText("No data", padLeft + chartW / 2, centerY);
    ctx.restore();
  }
}

// ─── Time Axis ─────────────────────────────────────────────────────────────

export function drawTimeAxis(
  ctx: CanvasRenderingContext2D,
  palette: LiveCandlePalette,
  leftEdge: number,
  rightEdge: number,
  windowSecs: number,
  padLeft: number,
  chartW: number,
  y: number,
  alpha: number,
  formatTime: (t: number) => string
): void {
  if (alpha <= 0) return;
  const interval = niceTimeInterval(windowSecs);
  const firstTick = Math.ceil(leftEdge / interval) * interval;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = palette.labelFont;
  ctx.fillStyle = palette.timeLabel;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (let t = firstTick; t <= rightEdge; t += interval) {
    const x = padLeft + ((t - leftEdge) / (rightEdge - leftEdge)) * chartW;
    if (x < padLeft + 30 || x > padLeft + chartW - 30) continue;
    ctx.fillText(formatTime(t), x, y);
  }
  ctx.restore();
}

// ─── Reference Lines ───────────────────────────────────────────────────────

export function drawReferenceLines(
  ctx: CanvasRenderingContext2D,
  refs: ReferenceLine[],
  toY: (v: number) => number,
  padLeft: number,
  rightX: number,
  palette: LiveCandlePalette,
  alpha: number
): void {
  if (alpha <= 0 || refs.length === 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  for (const ref of refs) {
    const y = snap(toY(ref.value));
    const color = ref.color ?? palette.refLine;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    if (ref.dashed !== false) ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(rightX, y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (ref.label) {
      ctx.font = palette.labelFont;
      ctx.fillStyle = ref.color ?? palette.refLabel;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText(ref.label, rightX, y - 3);
    }
  }
  ctx.restore();
}

// ─── Edge Fade ─────────────────────────────────────────────────────────────

export function drawEdgeFade(
  ctx: CanvasRenderingContext2D,
  padLeft: number,
  h: number
): void {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  const grad = ctx.createLinearGradient(
    padLeft,
    0,
    padLeft + FADE_EDGE_WIDTH,
    0
  );
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, padLeft + FADE_EDGE_WIDTH, h);
  ctx.restore();
}

// ─── Particles ─────────────────────────────────────────────────────────────

export function spawnParticles(
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
  if (swingMagnitude < 0.08) {
    state.burstCount = 0;
    return 0;
  }
  if (momentum === "down" && !options?.downMomentum) return 0;
  if (state.burstCount >= 3) return 0;

  state.cooldown = 400;
  const scale = options?.scale ?? 1;
  const mag = Math.min(swingMagnitude * 5, 1);
  const falloff =
    mag > 0.6 ? 1 : [1, 0.6, 0.35][state.burstCount] ?? 0.35;
  state.burstCount++;
  const count = Math.round((12 + mag * 20) * scale * falloff);
  const isUp = momentum === "up";

  for (let i = 0; i < count && state.particles.length < 80; i++) {
    const baseAngle = isUp ? -Math.PI / 2 : Math.PI / 2;
    const angle =
      baseAngle + (Math.random() - 0.5) * Math.PI * 1.2;
    const speed = (60 + Math.random() * 100) * (1 + mag * 0.8);
    state.particles.push({
      x: dotX + (Math.random() - 0.5) * 24,
      y: dotY + (Math.random() - 0.5) * 8,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: (1 + Math.random() * 1.2) * scale * falloff,
      color,
    });
  }
  return falloff;
}

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  state: ParticleState,
  dt: number
): void {
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

// ─── Candle-mode Crosshair with OHLC info ──────────────────────────────────

export function drawCandleCrosshair(
  ctx: CanvasRenderingContext2D,
  candle: OHLCPoint,
  cx: number,
  padTop: number,
  padBottom: number,
  h: number,
  palette: LiveCandlePalette,
  formatPrice: (v: number) => string,
  formatTime: (t: number) => string,
  toY: (v: number) => number,
  alpha: number
): void {
  if (alpha <= 0) return;
  const isBullish = candle.close >= candle.open;
  const color = isBullish ? palette.bullish : palette.bearish;

  // Vertical crosshair line
  drawCrosshair(
    ctx,
    cx,
    toY(candle.close),
    padTop,
    padBottom,
    h,
    palette.crosshairLine,
    color,
    alpha
  );

  // OHLC tooltip (canvas-drawn at top)
  const labels = [
    `O ${formatPrice(candle.open)}`,
    `H ${formatPrice(candle.high)}`,
    `L ${formatPrice(candle.low)}`,
    `C ${formatPrice(candle.close)}`,
  ];
  const timeStr = formatTime(candle.time);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = palette.labelFont;
  ctx.textBaseline = "top";

  let tx = cx + 10;
  const totalW = labels.reduce(
    (sum, l) => sum + ctx.measureText(l).width + 12,
    0
  );
  // Flip to left if overflowing
  if (tx + totalW > ctx.canvas.width / (window.devicePixelRatio || 1) - 10) {
    tx = cx - totalW - 10;
  }

  let offsetX = tx;
  for (const label of labels) {
    ctx.fillStyle = palette.fg;
    ctx.fillText(label, offsetX, padTop + 4);
    offsetX += ctx.measureText(label).width + 12;
  }

  // Time below OHLC
  ctx.fillStyle = palette.fgMuted;
  ctx.fillText(timeStr, tx, padTop + 18);
  ctx.restore();
}

// ─── Frame Orchestrators ───────────────────────────────────────────────────

export interface CandleFrameOpts {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
  candles: OHLCPoint[];
  liveCandle?: OHLCPoint;
  smoothClose: number;
  palette: LiveCandlePalette;
  candleStyle: ResolvedCandleStyle;
  volumeStyle: ResolvedVolumeStyle;
  leftEdge: number;
  rightEdge: number;
  minVal: number;
  maxVal: number;
  valRange: number;
  windowSecs: number;
  toX: (t: number) => number;
  toY: (v: number) => number;
  reveal: number;
  hoveredIndex: number | null;
  hoverX: number | null;
  scrub: boolean;
  showGrid: boolean;
  showPriceAxis: boolean;
  showTimeAxis: boolean;
  showVolume: boolean;
  showBadge: boolean;
  momentum: Momentum;
  pulse: boolean;
  showMomentum: boolean;
  degen?: DegenOptions;
  particles: ParticleState;
  shakeAmplitude: number;
  refs: ReferenceLine[];
  formatPrice: (v: number) => string;
  formatTime: (t: number) => string;
  now_ms: number;
  dt: number;
}

export function drawCandleFrame(opts: CandleFrameOpts): number {
  const {
    ctx,
    w,
    h,
    pad,
    candles,
    liveCandle,
    smoothClose,
    palette,
    candleStyle,
    volumeStyle,
    leftEdge,
    rightEdge,
    minVal,
    maxVal,
    valRange,
    windowSecs,
    toX,
    toY,
    reveal,
    hoveredIndex,
    hoverX,
    scrub,
    showGrid,
    showPriceAxis,
    showTimeAxis,
    showVolume,
    showBadge,
    momentum,
    pulse,
    showMomentum,
    degen,
    particles,
    refs,
    formatPrice,
    formatTime,
    now_ms,
    dt,
  } = opts;

  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  const priceH = showVolume
    ? chartH * (1 - volumeStyle.heightRatio)
    : chartH;
  const volumeH = showVolume ? chartH * volumeStyle.heightRatio : 0;
  let shakeAmp = opts.shakeAmplitude;

  // Shake
  let shakeX = 0;
  let shakeY = 0;
  if (degen && shakeAmp > 0.2) {
    shakeX = (Math.random() - 0.5) * 2 * shakeAmp;
    shakeY = (Math.random() - 0.5) * 2 * shakeAmp;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  // Grid
  const gridAlpha =
    reveal < 0.7
      ? Math.pow(Math.max(0, reveal - 0.15) / 0.55, 2)
      : 1;
  if (showGrid) {
    drawGrid(
      ctx,
      palette,
      pad,
      w,
      chartW,
      priceH,
      minVal,
      valRange,
      toY,
      gridAlpha,
      formatPrice,
      showPriceAxis
    );
  }

  // Reference lines
  if (refs.length > 0) {
    drawReferenceLines(
      ctx,
      refs,
      toY,
      pad.left,
      w - pad.right,
      palette,
      reveal
    );
  }

  // Volume bars
  if (showVolume && volumeH > 0) {
    drawVolumeBars(
      ctx,
      candles,
      liveCandle,
      toX,
      candles.length > 1
        ? Math.abs(toX(candles[1].time) - toX(candles[0].time))
        : 10,
      palette,
      volumeStyle,
      pad.top + priceH,
      volumeH,
      reveal
    );
  }

  // Candles (clip to chart area)
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
  ctx.clip();

  const candleSpacing =
    candles.length > 1
      ? Math.abs(toX(candles[1].time) - toX(candles[0].time))
      : chartW / 30;

  drawAllCandles({
    ctx,
    candles,
    liveCandle,
    toX,
    toY,
    style: candleStyle,
    palette,
    candleSpacing,
    hoveredIndex,
    hoverX,
    scrub,
    reveal,
    now_ms,
    padLeft: pad.left,
    chartW,
  });
  ctx.restore();

  // Close price dashed line
  const closeY = toY(smoothClose);
  const isBullish = liveCandle
    ? liveCandle.close >= liveCandle.open
    : candles.length > 0
      ? candles[candles.length - 1].close >=
        candles[candles.length - 1].open
      : true;
  drawClosePrice(
    ctx,
    closeY,
    pad.left,
    w - pad.right,
    isBullish ? palette.bullish : palette.bearish,
    reveal * 0.4
  );

  // Live dot
  if (reveal > 0.3) {
    const dotAlpha = (reveal - 0.3) / 0.7;
    const dotColor = isBullish ? palette.dotUp : palette.dotDown;
    const glowColor = isBullish ? palette.glowUp : palette.glowDown;
    const dotX = liveCandle
      ? toX(liveCandle.time)
      : candles.length > 0
        ? toX(candles[candles.length - 1].time)
        : w - pad.right;
    drawDot(
      ctx,
      dotX,
      closeY,
      dotColor,
      glowColor,
      palette.bg,
      pulse,
      dotAlpha,
      now_ms
    );

    // Momentum arrows
    if (showMomentum && momentum !== "flat" && reveal > 0.6) {
      drawArrows(
        ctx,
        dotX,
        closeY,
        momentum,
        palette,
        (reveal - 0.6) / 0.4,
        now_ms
      );
    }

    // Degen particles
    if (degen) {
      const closes = candles.map((c) => c.close);
      if (liveCandle) closes.push(liveCandle.close);
      const lookback = Math.min(5, closes.length - 1);
      const recentDelta =
        lookback > 0
          ? Math.abs(closes[closes.length - 1] - closes[closes.length - 1 - lookback])
          : 0;
      const swing =
        valRange > 0 ? Math.min(recentDelta / valRange, 1) : 0;
      const burst = spawnParticles(
        particles,
        momentum,
        dotX,
        closeY,
        swing,
        isBullish ? palette.bullish : palette.bearish,
        dt,
        degen
      );
      if (burst > 0) shakeAmp = (3 + swing * 4) * burst;
      drawParticles(ctx, particles, dt);
    }
  }

  // Candle crosshair
  if (hoveredIndex !== null && scrub) {
    const all = liveCandle ? [...candles, liveCandle] : candles;
    const hc = all[hoveredIndex];
    if (hc) {
      drawCandleCrosshair(
        ctx,
        hc,
        toX(hc.time),
        pad.top,
        pad.bottom,
        h,
        palette,
        formatPrice,
        formatTime,
        toY,
        1
      );
    }
  }

  // Time axis
  if (showTimeAxis) {
    drawTimeAxis(
      ctx,
      palette,
      leftEdge,
      rightEdge,
      windowSecs,
      pad.left,
      chartW,
      h - pad.bottom + 4,
      reveal,
      formatTime
    );
  }

  // Price badge
  if (showBadge && reveal > 0.25) {
    const badgeAlpha = reveal < 0.5 ? (reveal - 0.25) / 0.25 : 1;
    const momColor =
      momentum === "up"
        ? palette.bullish
        : momentum === "down"
          ? palette.bearish
          : palette.line;
    drawPriceBadge(
      ctx,
      closeY,
      w - pad.right + 8,
      formatPrice(smoothClose),
      momColor,
      palette,
      badgeAlpha
    );
  }

  // Edge fade
  drawEdgeFade(ctx, pad.left, h);

  // Undo shake
  if (degen && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore();
  }

  return shakeAmp;
}

// ─── Line Frame ────────────────────────────────────────────────────────────

export interface LineFrameOpts {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  pad: { top: number; right: number; bottom: number; left: number };
  pts: [number, number][];
  smoothValue: number;
  palette: LiveCandlePalette;
  leftEdge: number;
  rightEdge: number;
  minVal: number;
  valRange: number;
  windowSecs: number;
  toX: (t: number) => number;
  toY: (v: number) => number;
  reveal: number;
  hoverX: number | null;
  scrub: boolean;
  showGrid: boolean;
  showPriceAxis: boolean;
  showTimeAxis: boolean;
  showFill: boolean;
  showBadge: boolean;
  momentum: Momentum;
  pulse: boolean;
  showMomentum: boolean;
  degen?: DegenOptions;
  particles: ParticleState;
  shakeAmplitude: number;
  refs: ReferenceLine[];
  formatPrice: (v: number) => string;
  formatTime: (t: number) => string;
  now_ms: number;
  dt: number;
  visible: TickPoint[];
}

export function drawLineFrame(opts: LineFrameOpts): number {
  const {
    ctx,
    w,
    h,
    pad,
    pts,
    smoothValue,
    palette,
    leftEdge,
    rightEdge,
    minVal,
    valRange,
    windowSecs,
    toX,
    toY,
    reveal,
    hoverX,
    scrub,
    showGrid,
    showPriceAxis,
    showTimeAxis,
    showFill,
    showBadge,
    momentum,
    pulse,
    showMomentum,
    degen,
    particles,
    refs,
    formatPrice,
    formatTime,
    now_ms,
    dt,
    visible,
  } = opts;

  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;
  let shakeAmp = opts.shakeAmplitude;

  // Shake
  let shakeX = 0;
  let shakeY = 0;
  if (degen && shakeAmp > 0.2) {
    shakeX = (Math.random() - 0.5) * 2 * shakeAmp;
    shakeY = (Math.random() - 0.5) * 2 * shakeAmp;
    ctx.save();
    ctx.translate(shakeX, shakeY);
  }

  // Grid
  const gridAlpha =
    reveal < 0.7
      ? Math.pow(Math.max(0, reveal - 0.15) / 0.55, 2)
      : 1;
  if (showGrid) {
    drawGrid(
      ctx,
      palette,
      pad,
      w,
      chartW,
      chartH,
      minVal,
      valRange,
      toY,
      gridAlpha,
      formatPrice,
      showPriceAxis
    );
  }

  // Reference lines
  if (refs.length > 0) {
    drawReferenceLines(
      ctx,
      refs,
      toY,
      pad.left,
      w - pad.right,
      palette,
      reveal
    );
  }

  // Line + fill (clip to chart)
  const breath = loadingBreath(now_ms);
  const lineAlpha = reveal < 1 ? breath + (1 - breath) * reveal : 1;
  const fillAlpha = reveal;
  const strokeColor =
    reveal < 1
      ? blendColors(palette.gridLabel, palette.line, Math.min(1, reveal * 3))
      : palette.line;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left - 1, pad.top, chartW + 2, chartH);
  ctx.clip();
  drawLine(
    ctx,
    pts,
    palette,
    pad.top,
    pad.bottom,
    h,
    showFill,
    lineAlpha,
    fillAlpha,
    strokeColor,
    hoverX,
    scrub
  );
  ctx.restore();

  // Dashed current price line
  const currentY = toY(smoothValue);
  drawClosePrice(
    ctx,
    currentY,
    pad.left,
    w - pad.right,
    palette.dashLine,
    reveal
  );

  // Live dot
  const lastPt = pts[pts.length - 1];
  if (reveal > 0.3 && lastPt) {
    const dotAlpha = (reveal - 0.3) / 0.7;
    const dotColor =
      momentum === "up"
        ? palette.dotUp
        : momentum === "down"
          ? palette.dotDown
          : palette.dotFlat;
    const glowColor =
      momentum === "up"
        ? palette.glowUp
        : momentum === "down"
          ? palette.glowDown
          : palette.line;
    drawDot(
      ctx,
      lastPt[0],
      lastPt[1],
      dotColor,
      glowColor,
      palette.bg,
      pulse,
      dotAlpha,
      now_ms
    );

    // Momentum arrows
    if (showMomentum && momentum !== "flat" && reveal > 0.6) {
      drawArrows(
        ctx,
        lastPt[0],
        lastPt[1],
        momentum,
        palette,
        (reveal - 0.6) / 0.4,
        now_ms
      );
    }

    // Degen
    if (degen) {
      const vals = visible.map((p) => p.value);
      const lookback = Math.min(5, vals.length - 1);
      const recentDelta =
        lookback > 0
          ? Math.abs(vals[vals.length - 1] - vals[vals.length - 1 - lookback])
          : 0;
      const swing =
        valRange > 0 ? Math.min(recentDelta / valRange, 1) : 0;
      const burst = spawnParticles(
        particles,
        momentum,
        lastPt[0],
        lastPt[1],
        swing,
        palette.line,
        dt,
        degen
      );
      if (burst > 0) shakeAmp = (3 + swing * 4) * burst;
      drawParticles(ctx, particles, dt);
    }
  }

  // Line crosshair
  if (
    scrub &&
    hoverX !== null &&
    hoverX >= pad.left &&
    hoverX <= w - pad.right
  ) {
    const hoverTime =
      leftEdge +
      ((hoverX - pad.left) / chartW) * (rightEdge - leftEdge);
    const hoverVal = interpolateAtTime(visible, hoverTime);
    if (hoverVal !== null) {
      const hy = clamp(toY(hoverVal), pad.top, h - pad.bottom);
      drawCrosshair(
        ctx,
        hoverX,
        hy,
        pad.top,
        pad.bottom,
        h,
        palette.crosshairLine,
        palette.line,
        1
      );

      // Value + time label
      ctx.save();
      ctx.font = palette.labelFont;
      ctx.textAlign = "center";
      ctx.fillStyle = palette.gridLabel;
      ctx.globalAlpha = 0.8;
      ctx.textBaseline = "bottom";
      ctx.fillText(formatPrice(hoverVal), hoverX, hy - 10);
      ctx.textBaseline = "top";
      ctx.fillText(formatTime(hoverTime), hoverX, h - pad.bottom + 4);
      ctx.restore();
    }
  }

  // Time axis
  if (showTimeAxis) {
    drawTimeAxis(
      ctx,
      palette,
      leftEdge,
      rightEdge,
      windowSecs,
      pad.left,
      chartW,
      h - pad.bottom + 4,
      reveal,
      formatTime
    );
  }

  // Badge
  if (showBadge && reveal > 0.25) {
    const badgeAlpha = reveal < 0.5 ? (reveal - 0.25) / 0.25 : 1;
    const momColor =
      momentum === "up"
        ? palette.bullish
        : momentum === "down"
          ? palette.bearish
          : palette.line;
    drawPriceBadge(
      ctx,
      currentY,
      w - pad.right + 8,
      formatPrice(smoothValue),
      momColor,
      palette,
      badgeAlpha
    );
  }

  // Fade
  drawEdgeFade(ctx, pad.left, h);

  // Undo shake
  if (degen && (shakeX !== 0 || shakeY !== 0)) {
    ctx.restore();
  }

  return shakeAmp;
}
