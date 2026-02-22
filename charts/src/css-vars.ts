/**
 * CSS variable tokens following the bklit design system.
 * These map to CSS custom properties that can be themed via Tailwind or raw CSS.
 */
export const cssVars = {
  // Base
  background: "var(--chart-background, #09090b)",
  foreground: "var(--chart-foreground, #fafafa)",
  foregroundMuted: "var(--chart-foreground-muted, #71717a)",

  // Grid & structure
  grid: "var(--chart-grid, rgba(255,255,255,0.06))",
  crosshair: "var(--chart-crosshair, rgba(255,255,255,0.12))",

  // Candlestick colors
  bullish: "var(--chart-bullish, #22c55e)",
  bullishMuted: "var(--chart-bullish-muted, rgba(34,197,94,0.15))",
  bearish: "var(--chart-bearish, #ef4444)",
  bearishMuted: "var(--chart-bearish-muted, rgba(239,68,68,0.15))",

  // Line colors (matching bklit)
  linePrimary: "var(--chart-line-primary, #3b82f6)",
  lineSecondary: "var(--chart-line-secondary, #8b5cf6)",

  // Volume
  volumeUp: "var(--chart-volume-up, rgba(34,197,94,0.25))",
  volumeDown: "var(--chart-volume-down, rgba(239,68,68,0.25))",

  // Tooltip
  tooltipBg: "var(--chart-tooltip-bg, rgba(24,24,27,0.95))",
  tooltipBorder: "var(--chart-tooltip-border, rgba(255,255,255,0.08))",
  tooltipText: "var(--chart-tooltip-text, #fafafa)",
  tooltipMuted: "var(--chart-tooltip-muted, #a1a1aa)",

  // Ticker specific
  tickerGlow: "var(--chart-ticker-glow, rgba(59,130,246,0.4))",
  tickerPulse: "var(--chart-ticker-pulse, rgba(59,130,246,0.15))",
} as const;

/**
 * Default CSS custom property values for dark theme.
 * Apply these to your root element or chart container.
 */
export const darkThemeVars = `
  --chart-background: #09090b;
  --chart-foreground: #fafafa;
  --chart-foreground-muted: #71717a;
  --chart-grid: rgba(255,255,255,0.06);
  --chart-crosshair: rgba(255,255,255,0.12);
  --chart-bullish: #22c55e;
  --chart-bullish-muted: rgba(34,197,94,0.15);
  --chart-bearish: #ef4444;
  --chart-bearish-muted: rgba(239,68,68,0.15);
  --chart-line-primary: #3b82f6;
  --chart-line-secondary: #8b5cf6;
  --chart-volume-up: rgba(34,197,94,0.25);
  --chart-volume-down: rgba(239,68,68,0.25);
  --chart-tooltip-bg: rgba(24,24,27,0.95);
  --chart-tooltip-border: rgba(255,255,255,0.08);
  --chart-tooltip-text: #fafafa;
  --chart-tooltip-muted: #a1a1aa;
  --chart-ticker-glow: rgba(59,130,246,0.4);
  --chart-ticker-pulse: rgba(59,130,246,0.15);
`;

/**
 * Default CSS custom property values for light theme.
 */
export const lightThemeVars = `
  --chart-background: #ffffff;
  --chart-foreground: #09090b;
  --chart-foreground-muted: #71717a;
  --chart-grid: rgba(0,0,0,0.06);
  --chart-crosshair: rgba(0,0,0,0.08);
  --chart-bullish: #16a34a;
  --chart-bullish-muted: rgba(22,163,74,0.1);
  --chart-bearish: #dc2626;
  --chart-bearish-muted: rgba(220,38,38,0.1);
  --chart-line-primary: #2563eb;
  --chart-line-secondary: #7c3aed;
  --chart-volume-up: rgba(22,163,74,0.15);
  --chart-volume-down: rgba(220,38,38,0.15);
  --chart-tooltip-bg: rgba(255,255,255,0.95);
  --chart-tooltip-border: rgba(0,0,0,0.08);
  --chart-tooltip-text: #09090b;
  --chart-tooltip-muted: #71717a;
  --chart-ticker-glow: rgba(37,99,235,0.3);
  --chart-ticker-pulse: rgba(37,99,235,0.1);
`;
