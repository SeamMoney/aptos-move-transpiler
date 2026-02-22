"use client";

import { AnimatePresence, motion, useSpring } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cssVars } from "./css-vars";
import type { PriceDirection, TooltipRow } from "./types";

// ─── Tooltip Dot ────────────────────────────────────────────────────────────

interface TooltipDotProps {
  x: number;
  y: number;
  color: string;
  visible: boolean;
  strokeColor?: string;
  radius?: number;
}

export function TooltipDot({
  x,
  y,
  color,
  visible,
  strokeColor = cssVars.background,
  radius = 4,
}: TooltipDotProps) {
  const springX = useSpring(x, { stiffness: 300, damping: 30 });
  const springY = useSpring(y, { stiffness: 300, damping: 30 });

  useEffect(() => { springX.set(x); }, [x, springX]);
  useEffect(() => { springY.set(y); }, [y, springY]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.circle
          animate={{ opacity: 1, scale: 1 }}
          cx={springX}
          cy={springY}
          exit={{ opacity: 0, scale: 0.5 }}
          fill={color}
          initial={{ opacity: 0, scale: 0.5 }}
          r={radius}
          stroke={strokeColor}
          strokeWidth={2}
          transition={{ duration: 0.2, ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}

// ─── Crosshair / Indicator ──────────────────────────────────────────────────

interface CrosshairProps {
  x: number;
  height: number;
  visible: boolean;
  color?: string;
  fadeEdges?: boolean;
}

export function Crosshair({
  x,
  height,
  visible,
  color = cssVars.crosshair,
  fadeEdges = true,
}: CrosshairProps) {
  const springX = useSpring(x, { stiffness: 300, damping: 30 });
  useEffect(() => { springX.set(x); }, [x, springX]);

  const gradientId = useMemo(
    () => `crosshair-fade-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  return (
    <AnimatePresence>
      {visible && (
        <motion.g
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {fadeEdges && (
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0} />
                <stop offset="10%" stopColor={color} stopOpacity={1} />
                <stop offset="90%" stopColor={color} stopOpacity={1} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
          )}
          <motion.line
            stroke={fadeEdges ? `url(#${gradientId})` : color}
            strokeWidth={1}
            x1={springX}
            x2={springX}
            y1={0}
            y2={height}
          />
        </motion.g>
      )}
    </AnimatePresence>
  );
}

// ─── Horizontal price line ──────────────────────────────────────────────────

interface PriceLineProps {
  y: number;
  width: number;
  visible: boolean;
  color?: string;
}

export function PriceLine({
  y,
  width,
  visible,
  color = cssVars.crosshair,
}: PriceLineProps) {
  const springY = useSpring(y, { stiffness: 300, damping: 30 });
  useEffect(() => { springY.set(y); }, [y, springY]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.line
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          initial={{ opacity: 0 }}
          stroke={color}
          strokeDasharray="4 4"
          strokeWidth={1}
          transition={{ duration: 0.15 }}
          x1={0}
          x2={width}
          y1={springY}
          y2={springY}
        />
      )}
    </AnimatePresence>
  );
}

// ─── Tooltip Panel ──────────────────────────────────────────────────────────

interface ChartTooltipProps {
  visible: boolean;
  x: number;
  containerWidth: number;
  title?: string;
  subtitle?: string;
  rows: TooltipRow[];
  direction?: PriceDirection;
}

export function ChartTooltip({
  visible,
  x,
  containerWidth,
  title,
  subtitle,
  rows,
  direction,
}: ChartTooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipWidth, setTooltipWidth] = useState(180);
  const [flipped, setFlipped] = useState(false);

  const springX = useSpring(x, { stiffness: 100, damping: 20 });
  useEffect(() => { springX.set(x); }, [x, springX]);

  useLayoutEffect(() => {
    if (tooltipRef.current) {
      setTooltipWidth(tooltipRef.current.offsetWidth);
    }
  });

  useEffect(() => {
    const offset = 16;
    const wouldOverflow = x + tooltipWidth + offset > containerWidth;
    setFlipped(wouldOverflow);
  }, [x, tooltipWidth, containerWidth]);

  const directionColor = direction === "up"
    ? cssVars.bullish
    : direction === "down"
      ? cssVars.bearish
      : cssVars.foregroundMuted;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="pointer-events-none absolute top-0"
          exit={{ opacity: 0 }}
          initial={{ opacity: 0, y: 4 }}
          ref={tooltipRef}
          style={{
            left: flipped ? undefined : x + 16,
            right: flipped ? containerWidth - x + 16 : undefined,
            top: 8,
            zIndex: 50,
          }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div
            style={{
              background: cssVars.tooltipBg,
              border: `1px solid ${cssVars.tooltipBorder}`,
              borderRadius: 8,
              padding: "10px 14px",
              backdropFilter: "blur(12px)",
              minWidth: 140,
            }}
          >
            {title && (
              <div
                style={{
                  color: cssVars.tooltipText,
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: subtitle || rows.length > 0 ? 6 : 0,
                }}
              >
                {title}
              </div>
            )}
            {subtitle && (
              <div
                style={{
                  color: directionColor,
                  fontSize: 11,
                  fontWeight: 500,
                  marginBottom: rows.length > 0 ? 8 : 0,
                }}
              >
                {subtitle}
              </div>
            )}
            {rows.map((row, i) => (
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
                  <span
                    style={{
                      color: cssVars.tooltipMuted,
                      fontSize: 12,
                    }}
                  >
                    {row.label}
                  </span>
                </div>
                <span
                  style={{
                    color: cssVars.tooltipText,
                    fontSize: 12,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {typeof row.value === "number"
                    ? row.value.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : row.value}
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
