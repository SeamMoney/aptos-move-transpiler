"use client";

/**
 * Demo: Candlestick + Ticker Line Charts in the bklit style
 *
 * Usage:
 *   Import into any React app:
 *     import { CandlestickDemo, TickerDemo, StreamingTickerDemo } from "./demo";
 */

import { useEffect, useMemo, useRef } from "react";
import {
  CandlestickChart,
  TickerLineChart,
  generateOHLCData,
  generateTickerData,
  createPriceStream,
  type TickerLineChartHandle,
} from "../src";

// ─── Static Candlestick Chart ───────────────────────────────────────────────

export function CandlestickDemo() {
  const data = useMemo(
    () =>
      generateOHLCData({
        count: 80,
        startPrice: 42_150,
        volatility: 0.02,
        drift: 0.0003,
        interval: "1h",
        baseVolume: 120_000,
      }),
    []
  );

  return (
    <div style={{ width: "100%", maxWidth: 900 }}>
      <CandlestickChart
        data={data}
        animationDuration={1200}
        showGrid
        showVolume
        showPriceAxis
        showTimeAxis
        formatPrice={(v) => `$${v.toLocaleString()}`}
        aspectRatio="5 / 2"
        candleStyle={{
          bodyWidthRatio: 0.6,
          wickWidth: 1.5,
          bodyRadius: 1,
        }}
      />
    </div>
  );
}

// ─── Large Dataset Candlestick (perf test) ──────────────────────────────────

export function CandlestickPerfDemo() {
  const data = useMemo(
    () =>
      generateOHLCData({
        count: 500,
        startPrice: 1800,
        volatility: 0.015,
        interval: "15m",
      }),
    []
  );

  return (
    <div style={{ width: "100%", maxWidth: 1200 }}>
      <CandlestickChart
        data={data}
        animationDuration={800}
        showGrid
        showVolume
        // With 500 candles, this automatically uses BatchedCandles
        // rendering with clip-path sweep instead of per-candle animations
        maxAnimatedCandles={150}
        formatPrice={(v) => `$${v.toFixed(2)}`}
        aspectRatio="4 / 1"
      />
    </div>
  );
}

// ─── Static Ticker Line Chart ───────────────────────────────────────────────

export function TickerDemo() {
  const data = useMemo(
    () =>
      generateTickerData({
        count: 200,
        startPrice: 67_800,
        volatility: 0.0008,
        tickIntervalMs: 5000,
      }),
    []
  );

  return (
    <div style={{ width: "100%", maxWidth: 900 }}>
      <TickerLineChart
        data={data}
        animationDuration={900}
        showGrid
        showArea
        showPriceAxis
        showTimeAxis
        formatPrice={(v) => `$${v.toLocaleString()}`}
      />
    </div>
  );
}

// ─── Streaming Ticker (real-time) ───────────────────────────────────────────

export function StreamingTickerDemo() {
  const chartRef = useRef<TickerLineChartHandle>(null);

  const initialData = useMemo(
    () =>
      generateTickerData({
        count: 100,
        startPrice: 3_420,
        volatility: 0.0005,
        tickIntervalMs: 1000,
      }),
    []
  );

  useEffect(() => {
    const cleanup = createPriceStream({
      startPrice: initialData[initialData.length - 1]!.price,
      volatility: 0.0006,
      intervalMs: 200,
      onTick: (point) => {
        chartRef.current?.push(point);
      },
    });
    return cleanup;
  }, [initialData]);

  return (
    <div style={{ width: "100%", maxWidth: 900 }}>
      <TickerLineChart
        ref={chartRef}
        data={initialData}
        streaming
        streamConfig={{
          fps: 60,
          maxPoints: 300,
          smoothing: 0.12,
          springPhysics: true,
        }}
        animationDuration={600}
        showGrid
        showArea
        areaOpacity={0.06}
        formatPrice={(v) => `$${v.toFixed(2)}`}
      />
    </div>
  );
}
