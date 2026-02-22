"use client";

import type { ScaleLinear } from "d3-scale";
import { motion, useSpring } from "motion/react";
import { useEffect, useMemo } from "react";
import { cssVars } from "./css-vars";
import type { PriceDirection } from "./types";

// ─── Y-Axis (price labels) ─────────────────────────────────────────────────

interface PriceAxisProps {
  yScale: ScaleLinear<number, number>;
  width: number;
  marginLeft: number;
  numTicks?: number;
  formatPrice?: (value: number) => string;
}

export function PriceAxis({
  yScale,
  width,
  marginLeft,
  numTicks = 5,
  formatPrice = defaultFormat,
}: PriceAxisProps) {
  const ticks = useMemo(() => {
    const values = yScale.ticks(numTicks);
    return values.map((value) => ({
      value,
      y: yScale(value),
      label: formatPrice(value),
    }));
  }, [yScale, numTicks, formatPrice]);

  return (
    <g>
      {ticks.map((tick) => (
        <text
          dominantBaseline="middle"
          fill={cssVars.foregroundMuted}
          fontSize={11}
          fontWeight={400}
          key={tick.value}
          textAnchor="end"
          x={marginLeft - 8}
          y={tick.y}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {tick.label}
        </text>
      ))}
    </g>
  );
}

// ─── Floating current price label ───────────────────────────────────────────

interface CurrentPriceLabelProps {
  price: number;
  y: number;
  width: number;
  direction: PriceDirection;
  visible: boolean;
  formatPrice?: (value: number) => string;
}

export function CurrentPriceLabel({
  price,
  y,
  width,
  direction,
  visible,
  formatPrice = defaultFormat,
}: CurrentPriceLabelProps) {
  const springY = useSpring(y, { stiffness: 200, damping: 28 });
  useEffect(() => { springY.set(y); }, [y, springY]);

  const bgColor = direction === "up"
    ? cssVars.bullish
    : direction === "down"
      ? cssVars.bearish
      : cssVars.foregroundMuted;

  if (!visible) return null;

  return (
    <motion.g
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Dashed line across chart */}
      <motion.line
        stroke={bgColor}
        strokeDasharray="4 4"
        strokeOpacity={0.4}
        strokeWidth={1}
        x1={0}
        x2={width}
        y1={springY}
        y2={springY}
      />
      {/* Price badge */}
      <motion.g style={{ y: springY }}>
        <motion.rect
          fill={bgColor}
          height={22}
          rx={4}
          width={70}
          x={width + 4}
          y={-11}
        />
        <motion.text
          dominantBaseline="middle"
          fill="#fff"
          fontSize={11}
          fontWeight={600}
          textAnchor="middle"
          x={width + 39}
          y={0}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {formatPrice(price)}
        </motion.text>
      </motion.g>
    </motion.g>
  );
}

// ─── X-Axis (time labels) ───────────────────────────────────────────────────

interface TimeAxisProps {
  xScale: ReturnType<typeof import("@visx/scale").scaleTime<number>>;
  marginLeft: number;
  height: number;
  numTicks?: number;
  crosshairX?: number | null;
  isHovering?: boolean;
  formatTime?: (date: Date) => string;
}

export function TimeAxis({
  xScale,
  marginLeft,
  height,
  numTicks = 6,
  crosshairX = null,
  isHovering = false,
  formatTime,
}: TimeAxisProps) {
  const labels = useMemo(() => {
    const ticks = xScale.ticks(numTicks);
    const format = formatTime ?? ((d: Date) =>
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
    return ticks.map((date) => ({
      date,
      x: (xScale(date) ?? 0) + marginLeft,
      label: format(date),
    }));
  }, [xScale, marginLeft, numTicks, formatTime]);

  return (
    <div
      className="pointer-events-none absolute inset-0"
      style={{ top: height + 8 }}
    >
      {labels.map((item) => {
        let opacity = 1;
        if (isHovering && crosshairX !== null) {
          const distance = Math.abs(item.x - crosshairX);
          if (distance < 50) opacity = 0;
          else if (distance < 70) opacity = (distance - 50) / 20;
        }
        return (
          <motion.div
            animate={{ opacity }}
            className="absolute whitespace-nowrap"
            key={item.label}
            style={{
              left: item.x,
              transform: "translateX(-50%)",
              color: cssVars.foregroundMuted,
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
            }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            {item.label}
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function defaultFormat(value: number): string {
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(4);
}
