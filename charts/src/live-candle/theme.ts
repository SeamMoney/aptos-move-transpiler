import type { ThemeMode, LiveCandlePalette } from "./types";

// ─── Color Parsing ─────────────────────────────────────────────────────────

export function parseRgb(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }
  const m = color.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return [128, 128, 128];
}

function rgba(r: number, g: number, b: number, a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

export function blendColors(c1: string, c2: string, t: number): string {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const [r1, g1, b1] = parseRgb(c1);
  const [r2, g2, b2] = parseRgb(c2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

export function brightenColor(color: string, amount: number): string {
  const [r, g, b] = parseRgb(color);
  const f = 1 + amount;
  return `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`;
}

export function darkenColor(color: string, amount: number): string {
  const [r, g, b] = parseRgb(color);
  const f = 1 - amount;
  return `rgb(${Math.max(0, Math.round(r * f))},${Math.max(0, Math.round(g * f))},${Math.max(0, Math.round(b * f))})`;
}

// ─── CSS Variable Token Names ──────────────────────────────────────────────

const VAR_NAMES = {
  bg: "--lc-bg",
  fg: "--lc-fg",
  fgMuted: "--lc-fg-muted",
  grid: "--lc-grid",
  crosshair: "--lc-crosshair",
  bullish: "--lc-bullish",
  bullishMuted: "--lc-bullish-muted",
  bearish: "--lc-bearish",
  bearishMuted: "--lc-bearish-muted",
  wickBullish: "--lc-wick-bullish",
  wickBearish: "--lc-wick-bearish",
  volumeUp: "--lc-volume-up",
  volumeDown: "--lc-volume-down",
  linePrimary: "--lc-line-primary",
  tooltipBg: "--lc-tooltip-bg",
  tooltipBorder: "--lc-tooltip-border",
  tooltipText: "--lc-tooltip-text",
  tooltipMuted: "--lc-tooltip-muted",
  timeLabel: "--lc-time-label",
} as const;

// ─── CSS Variable Resolution ───────────────────────────────────────────────

function readVar(
  el: HTMLElement | null,
  name: string,
  fallback: string
): string {
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * Resolves the full palette by:
 * 1. Reading CSS custom properties from the container element
 * 2. Falling back to computed defaults based on accent color + theme mode
 *
 * This gives users two customization paths:
 * - Simple: <LiveCandle accentColor="#3b82f6" theme="dark" />
 * - Advanced: set --lc-bullish, --lc-bearish, etc. on a parent element
 */
export function resolvePalette(
  el: HTMLElement | null,
  accent: string,
  mode: ThemeMode
): LiveCandlePalette {
  const isDark = mode === "dark";
  const [ar, ag, ab] = parseRgb(accent);

  const bullish = readVar(el, VAR_NAMES.bullish, "#22c55e");
  const bearish = readVar(el, VAR_NAMES.bearish, "#ef4444");
  const bullishRgb = parseRgb(bullish);
  const bearishRgb = parseRgb(bearish);
  const lineColor = readVar(el, VAR_NAMES.linePrimary, accent);
  const lineRgb = parseRgb(lineColor);
  const bg = readVar(
    el,
    VAR_NAMES.bg,
    isDark ? "#09090b" : "#ffffff"
  );
  const bgRgb = parseRgb(bg);

  return {
    bg,
    bgRgb,
    fg: readVar(el, VAR_NAMES.fg, isDark ? "#fafafa" : "#09090b"),
    fgMuted: readVar(
      el,
      VAR_NAMES.fgMuted,
      isDark ? "#71717a" : "#71717a"
    ),

    gridLine: readVar(
      el,
      VAR_NAMES.grid,
      isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)"
    ),
    gridLabel: isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)",

    bullish,
    bullishRgb,
    bullishMuted: readVar(
      el,
      VAR_NAMES.bullishMuted,
      rgba(bullishRgb[0], bullishRgb[1], bullishRgb[2], 0.15)
    ),
    bearish,
    bearishRgb,
    bearishMuted: readVar(
      el,
      VAR_NAMES.bearishMuted,
      rgba(bearishRgb[0], bearishRgb[1], bearishRgb[2], 0.15)
    ),

    wickBullish: readVar(el, VAR_NAMES.wickBullish, bullish),
    wickBearish: readVar(el, VAR_NAMES.wickBearish, bearish),

    volumeUp: readVar(
      el,
      VAR_NAMES.volumeUp,
      rgba(bullishRgb[0], bullishRgb[1], bullishRgb[2], 0.25)
    ),
    volumeDown: readVar(
      el,
      VAR_NAMES.volumeDown,
      rgba(bearishRgb[0], bearishRgb[1], bearishRgb[2], 0.25)
    ),

    line: lineColor,
    lineRgb,
    lineWidth: 2,
    fillTop: rgba(lineRgb[0], lineRgb[1], lineRgb[2], isDark ? 0.12 : 0.08),
    fillBottom: rgba(lineRgb[0], lineRgb[1], lineRgb[2], 0),

    dotUp: bullish,
    dotDown: bearish,
    dotFlat: lineColor,
    glowUp: rgba(bullishRgb[0], bullishRgb[1], bullishRgb[2], 0.2),
    glowDown: rgba(bearishRgb[0], bearishRgb[1], bearishRgb[2], 0.2),

    crosshairLine: readVar(
      el,
      VAR_NAMES.crosshair,
      isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.1)"
    ),

    tooltipBg: readVar(
      el,
      VAR_NAMES.tooltipBg,
      isDark ? "rgba(24,24,27,0.95)" : "rgba(255,255,255,0.95)"
    ),
    tooltipBorder: readVar(
      el,
      VAR_NAMES.tooltipBorder,
      isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"
    ),
    tooltipText: readVar(
      el,
      VAR_NAMES.tooltipText,
      isDark ? "#e5e5e5" : "#1a1a1a"
    ),
    tooltipMuted: readVar(
      el,
      VAR_NAMES.tooltipMuted,
      isDark ? "#a1a1aa" : "#71717a"
    ),

    badgeBg: isDark ? "rgba(40,40,40,0.95)" : "rgba(255,255,255,0.95)",
    badgeText: "#ffffff",

    dashLine: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    refLine: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)",
    refLabel: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.4)",
    timeLabel: readVar(
      el,
      VAR_NAMES.timeLabel,
      isDark ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.25)"
    ),

    labelFont: '11px "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    valueFont:
      '600 11px "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    badgeFont:
      '500 11px "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
  };
}

// ─── Exportable CSS Theme Strings ──────────────────────────────────────────

export const darkThemeVars = `
  --lc-bg: #09090b;
  --lc-fg: #fafafa;
  --lc-fg-muted: #71717a;
  --lc-grid: rgba(255,255,255,0.05);
  --lc-crosshair: rgba(255,255,255,0.15);
  --lc-bullish: #22c55e;
  --lc-bullish-muted: rgba(34,197,94,0.15);
  --lc-bearish: #ef4444;
  --lc-bearish-muted: rgba(239,68,68,0.15);
  --lc-wick-bullish: #22c55e;
  --lc-wick-bearish: #ef4444;
  --lc-volume-up: rgba(34,197,94,0.25);
  --lc-volume-down: rgba(239,68,68,0.25);
  --lc-line-primary: #3b82f6;
  --lc-tooltip-bg: rgba(24,24,27,0.95);
  --lc-tooltip-border: rgba(255,255,255,0.08);
  --lc-tooltip-text: #e5e5e5;
  --lc-tooltip-muted: #a1a1aa;
  --lc-time-label: rgba(255,255,255,0.3);
`;

export const lightThemeVars = `
  --lc-bg: #ffffff;
  --lc-fg: #09090b;
  --lc-fg-muted: #71717a;
  --lc-grid: rgba(0,0,0,0.05);
  --lc-crosshair: rgba(0,0,0,0.1);
  --lc-bullish: #16a34a;
  --lc-bullish-muted: rgba(22,163,74,0.1);
  --lc-bearish: #dc2626;
  --lc-bearish-muted: rgba(220,38,38,0.1);
  --lc-wick-bullish: #16a34a;
  --lc-wick-bearish: #dc2626;
  --lc-volume-up: rgba(22,163,74,0.15);
  --lc-volume-down: rgba(220,38,38,0.15);
  --lc-line-primary: #2563eb;
  --lc-tooltip-bg: rgba(255,255,255,0.95);
  --lc-tooltip-border: rgba(0,0,0,0.08);
  --lc-tooltip-text: #09090b;
  --lc-tooltip-muted: #71717a;
  --lc-time-label: rgba(0,0,0,0.25);
`;
