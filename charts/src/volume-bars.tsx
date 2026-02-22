"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { cssVars } from "./css-vars";
import type { OHLCDataPoint } from "./types";

interface VolumeBarProps {
  x: number;
  y: number;
  width: number;
  height: number;
  isBullish: boolean;
  index: number;
  totalBars: number;
  animationDuration: number;
  isHovered: boolean;
}

function VolumeBar({
  x,
  y,
  width,
  height,
  isBullish,
  index,
  totalBars,
  animationDuration,
  isHovered,
}: VolumeBarProps) {
  const fill = isBullish ? cssVars.volumeUp : cssVars.volumeDown;
  const delay = (index / totalBars) * (animationDuration / 1000) * 0.6;

  return (
    <motion.rect
      animate={{
        height,
        y,
        opacity: isHovered ? 1 : 0.7,
      }}
      fill={fill}
      height={0}
      initial={{ height: 0, y: y + height, opacity: 0 }}
      rx={1}
      transition={{
        height: { duration: animationDuration / 1000 * 0.4, delay, ease: "easeOut" },
        y: { duration: animationDuration / 1000 * 0.4, delay, ease: "easeOut" },
        opacity: { duration: 0.2, ease: "easeInOut" },
      }}
      width={Math.max(1, width)}
      x={x}
    />
  );
}

interface VolumeBarsProps {
  data: OHLCDataPoint[];
  xScale: (date: Date) => number;
  yScaleVolume: (volume: number) => number;
  volumeHeight: number;
  innerWidth: number;
  innerHeight: number;
  animationDuration?: number;
  hoveredIndex?: number | null;
  /** Ratio of chart height dedicated to volume (0-1) */
  heightRatio?: number;
}

export function VolumeBars({
  data,
  xScale,
  yScaleVolume,
  volumeHeight,
  innerWidth,
  innerHeight,
  animationDuration = 800,
  hoveredIndex = null,
}: VolumeBarsProps) {
  const barWidth = useMemo(() => {
    if (data.length < 2) return 0;
    const spacing = innerWidth / data.length;
    return Math.max(1, spacing * 0.6);
  }, [data.length, innerWidth]);

  return (
    <g transform={`translate(0, ${innerHeight - volumeHeight})`}>
      {data.map((d, i) => {
        const x = xScale(d.date) - barWidth / 2;
        const barH = volumeHeight - yScaleVolume(d.volume);
        const y = yScaleVolume(d.volume);
        const isBullish = d.close >= d.open;

        return (
          <VolumeBar
            animationDuration={animationDuration}
            height={Math.max(0, barH)}
            index={i}
            isBullish={isBullish}
            isHovered={hoveredIndex === i}
            key={`vol-${i}`}
            totalBars={data.length}
            width={barWidth}
            x={x}
            y={y}
          />
        );
      })}
    </g>
  );
}
