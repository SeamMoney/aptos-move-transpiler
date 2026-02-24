/**
 * Deeply styled candlestick canvas rendering.
 *
 * Supports: rounded corners, hollow/filled bodies, vertical gradients,
 * drop shadows, custom wick styles, live candle glow/pulse, hover highlights
 * with brightness boost, and sub-pixel-precise alignment.
 */

import type {
  CandleStyle,
  LiveCandlePalette,
  OHLCPoint,
  ResolvedCandleStyle,
  ResolvedVolumeStyle,
  VolumeStyle,
} from "./types";
import { darkenColor } from "./theme";
import { snap } from "./math";

// ─── Style Resolution ──────────────────────────────────────────────────────

const DEFAULT_CANDLE_STYLE: ResolvedCandleStyle = {
  body: {
    widthRatio: 0.65,
    radius: 1.5,
    hollow: "bullish",
    strokeWidth: 1.5,
    gradient: true,
    gradientIntensity: 0.3,
    shadow: false,
    shadowBlur: 4,
    shadowOffsetY: 2,
    minHeight: 1,
  },
  wick: {
    width: 1.5,
    cap: "round",
    colorMode: "body",
    bullishColor: "#22c55e",
    bearishColor: "#ef4444",
  },
  live: {
    glow: true,
    glowIntensity: 0.5,
    pulseSpeed: 1500,
    borderFlash: true,
  },
  hover: {
    highlight: true,
    highlightRadius: 4,
    highlightOpacity: 0.15,
    brighten: 0.12,
  },
  gap: 2,
};

const DEFAULT_VOLUME_STYLE: ResolvedVolumeStyle = {
  heightRatio: 0.18,
  opacity: 0.3,
  radius: 1,
};

export function resolveCandleStyle(
  style?: CandleStyle,
  palette?: LiveCandlePalette
): ResolvedCandleStyle {
  if (!style && !palette) return DEFAULT_CANDLE_STYLE;
  const base = {
    body: { ...DEFAULT_CANDLE_STYLE.body, ...style?.body },
    wick: {
      ...DEFAULT_CANDLE_STYLE.wick,
      ...(palette
        ? {
            bullishColor: palette.wickBullish,
            bearishColor: palette.wickBearish,
          }
        : {}),
      ...style?.wick,
    },
    live: { ...DEFAULT_CANDLE_STYLE.live, ...style?.live },
    hover: { ...DEFAULT_CANDLE_STYLE.hover, ...style?.hover },
    gap: style?.gap ?? DEFAULT_CANDLE_STYLE.gap,
  };
  return base;
}

export function resolveVolumeStyle(style?: VolumeStyle): ResolvedVolumeStyle {
  if (!style) return DEFAULT_VOLUME_STYLE;
  return { ...DEFAULT_VOLUME_STYLE, ...style };
}

// ─── Rounded Rect Helper ───────────────────────────────────────────────────

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  if (h < 0) {
    y += h;
    h = -h;
  }
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── Single Candle Renderer ────────────────────────────────────────────────

export function drawSingleCandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  bodyW: number,
  openY: number,
  closeY: number,
  highY: number,
  lowY: number,
  isBullish: boolean,
  style: ResolvedCandleStyle,
  palette: LiveCandlePalette,
  isLive: boolean,
  isHovered: boolean,
  nowMs: number,
  alpha = 1
): void {
  const bodyColor = isBullish ? palette.bullish : palette.bearish;
  const mutedColor = isBullish ? palette.bullishMuted : palette.bearishMuted;
  const bodyTop = Math.min(openY, closeY);
  const bodyBottom = Math.max(openY, closeY);
  const bodyH = Math.max(style.body.minHeight, bodyBottom - bodyTop);
  const halfW = bodyW / 2;

  ctx.save();
  ctx.globalAlpha = alpha;

  // ── Hover highlight ──
  if (isHovered && style.hover.highlight) {
    ctx.save();
    ctx.globalAlpha = alpha * style.hover.highlightOpacity;
    ctx.fillStyle = mutedColor;
    ctx.beginPath();
    roundRect(
      ctx,
      x - halfW - 4,
      highY - 4,
      bodyW + 8,
      lowY - highY + 8,
      style.hover.highlightRadius
    );
    ctx.fill();
    ctx.restore();
  }

  // ── Live glow ──
  if (isLive && style.live.glow) {
    const t = (nowMs % style.live.pulseSpeed) / style.live.pulseSpeed;
    const pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    ctx.save();
    ctx.shadowColor = bodyColor;
    ctx.shadowBlur = 6 + pulse * 8 * style.live.glowIntensity;
    ctx.globalAlpha = alpha * (0.25 + pulse * 0.2);
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    roundRect(ctx, x - halfW, bodyTop, bodyW, bodyH, style.body.radius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── Wick ──
  const wickColor =
    style.wick.colorMode === "body"
      ? bodyColor
      : isBullish
        ? style.wick.bullishColor
        : style.wick.bearishColor;

  ctx.strokeStyle = wickColor;
  ctx.lineWidth = style.wick.width;
  ctx.lineCap = style.wick.cap;
  ctx.beginPath();
  const wx = snap(x);
  ctx.moveTo(wx, highY);
  ctx.lineTo(wx, lowY);
  ctx.stroke();

  // ── Shadow ──
  if (style.body.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowBlur = style.body.shadowBlur;
    ctx.shadowOffsetY = style.body.shadowOffsetY;
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    roundRect(ctx, x - halfW, bodyTop, bodyW, bodyH, style.body.radius);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── Body ──
  const isHollow =
    style.body.hollow === true ||
    (style.body.hollow === "bullish" && isBullish);

  if (isHollow) {
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = style.body.strokeWidth;
    ctx.beginPath();
    roundRect(ctx, x - halfW, bodyTop, bodyW, bodyH, style.body.radius);
    ctx.stroke();
  } else {
    if (style.body.gradient && bodyH > 2) {
      const grad = ctx.createLinearGradient(0, bodyTop, 0, bodyTop + bodyH);
      grad.addColorStop(0, bodyColor);
      grad.addColorStop(1, darkenColor(bodyColor, style.body.gradientIntensity * 0.4));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = bodyColor;
    }
    ctx.beginPath();
    roundRect(ctx, x - halfW, bodyTop, bodyW, bodyH, style.body.radius);
    ctx.fill();
  }

  // ── Live border flash ──
  if (isLive && style.live.borderFlash) {
    const t = (nowMs % style.live.pulseSpeed) / style.live.pulseSpeed;
    const pulse = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
    if (pulse > 0.5) {
      ctx.save();
      ctx.strokeStyle = bodyColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * (pulse - 0.5) * 0.6;
      ctx.beginPath();
      roundRect(
        ctx,
        x - halfW - 1,
        bodyTop - 1,
        bodyW + 2,
        bodyH + 2,
        style.body.radius + 1
      );
      ctx.stroke();
      ctx.restore();
    }
  }

  // ── Hover brighten ──
  if (isHovered && style.hover.brighten > 0) {
    ctx.save();
    ctx.globalAlpha = alpha * style.hover.brighten;
    ctx.fillStyle = "white";
    ctx.beginPath();
    roundRect(ctx, x - halfW, bodyTop, bodyW, bodyH, style.body.radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

// ─── Draw All Candles ──────────────────────────────────────────────────────

export interface DrawCandlesOpts {
  ctx: CanvasRenderingContext2D;
  candles: OHLCPoint[];
  liveCandle?: OHLCPoint;
  toX: (t: number) => number;
  toY: (v: number) => number;
  style: ResolvedCandleStyle;
  palette: LiveCandlePalette;
  candleSpacing: number;
  hoveredIndex: number | null;
  hoverX: number | null;
  scrub: boolean;
  reveal: number;
  now_ms: number;
  padLeft: number;
  chartW: number;
}

export function drawAllCandles(opts: DrawCandlesOpts): void {
  const {
    ctx,
    candles,
    liveCandle,
    toX,
    toY,
    style,
    palette,
    candleSpacing,
    hoveredIndex,
    hoverX,
    scrub,
    reveal,
    now_ms,
    padLeft,
    chartW,
  } = opts;

  const bodyW = Math.max(
    2,
    candleSpacing * style.body.widthRatio - style.gap
  );
  const allCandles = liveCandle ? [...candles, liveCandle] : candles;
  const liveIdx = liveCandle ? allCandles.length - 1 : -1;
  const chartRight = padLeft + chartW;

  for (let i = 0; i < allCandles.length; i++) {
    const c = allCandles[i];
    const x = toX(c.time);

    // Cull off-screen
    if (x + bodyW / 2 < padLeft - 10 || x - bodyW / 2 > chartRight + 10)
      continue;

    const isBullish = c.close >= c.open;
    const isLive = i === liveIdx;
    const isHovered = hoveredIndex === i;

    let alpha = 1;

    // Entrance reveal (staggered left→right)
    if (reveal < 1) {
      const normalized = (x - padLeft) / chartW;
      const localReveal = Math.max(
        0,
        Math.min(1, reveal * 1.5 - normalized * 0.5)
      );
      alpha *= localReveal;
      if (localReveal <= 0) continue;
    }

    // Scrub dimming
    if (scrub && hoverX !== null && x > hoverX) {
      alpha *= 0.35;
    }

    drawSingleCandle(
      ctx,
      x,
      bodyW,
      toY(c.open),
      toY(c.close),
      toY(c.high),
      toY(c.low),
      isBullish,
      style,
      palette,
      isLive,
      isHovered,
      now_ms,
      alpha
    );
  }
}

// ─── Volume Bars ───────────────────────────────────────────────────────────

export function drawVolumeBars(
  ctx: CanvasRenderingContext2D,
  candles: OHLCPoint[],
  toX: (t: number) => number,
  candleSpacing: number,
  volumeBottom: number,
  volumeHeight: number,
  maxVol: number,
  style: ResolvedCandleStyle,
  volStyle: ResolvedVolumeStyle,
  palette: LiveCandlePalette,
  hoveredIndex: number | null,
  chartLeft: number,
  chartRight: number
): void {
  if (maxVol <= 0) return;
  const bodyW = Math.max(
    2,
    candleSpacing * style.body.widthRatio - style.gap
  );

  ctx.save();
  ctx.globalAlpha = volStyle.opacity;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.volume === undefined || c.volume === 0) continue;
    const x = toX(c.time);
    if (x + bodyW / 2 < chartLeft || x - bodyW / 2 > chartRight) continue;

    const isBullish = c.close >= c.open;
    const barH = (c.volume / maxVol) * volumeHeight;
    const barY = volumeBottom - barH;

    ctx.fillStyle = isBullish ? palette.volumeUp : palette.volumeDown;

    if (hoveredIndex === i) {
      ctx.save();
      ctx.globalAlpha = volStyle.opacity * 1.5;
    }

    ctx.beginPath();
    roundRect(ctx, x - bodyW / 2, barY, bodyW, barH, volStyle.radius);
    ctx.fill();

    if (hoveredIndex === i) {
      ctx.restore();
    }
  }

  ctx.restore();
}

// ─── Close Price Dashed Line ───────────────────────────────────────────────

export function drawClosePrice(
  ctx: CanvasRenderingContext2D,
  y: number,
  left: number,
  right: number,
  color: string,
  alpha: number
): void {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(left, snap(y));
  ctx.lineTo(right, snap(y));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// ─── Price Badge ───────────────────────────────────────────────────────────

export function drawPriceBadge(
  ctx: CanvasRenderingContext2D,
  y: number,
  x: number,
  text: string,
  color: string,
  palette: LiveCandlePalette,
  alpha: number
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = palette.badgeFont;
  const tw = ctx.measureText(text).width;
  const bw = tw + 16;
  const bh = 22;

  ctx.fillStyle = color;
  ctx.beginPath();
  roundRect(ctx, x, y - bh / 2, bw, bh, 4);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + bw / 2, y);
  ctx.restore();
}
