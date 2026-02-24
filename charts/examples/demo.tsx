"use client";

/**
 * Demo: Candlestick + Ticker Line Charts in the bklit style
 *
 * Usage:
 *   Import into any React app:
 *     import { CandlestickDemo, TickerDemo, StreamingTickerDemo } from "./demo";
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickChart,
  TickerLineChart,
  Liveline,
  generateOHLCData,
  generateTickerData,
  createPriceStream,
  type TickerLineChartHandle,
  type LivelineHandle,
  type LivelinePoint,
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

// ─── Liveline Canvas Chart ─────────────────────────────────────────────────

export function LivelineDemo() {
  const chartRef = useRef<LivelineHandle>(null);
  const [value, setValue] = useState(3_420);

  const initialData = useMemo(() => {
    const now = Date.now() / 1000;
    const pts: LivelinePoint[] = [];
    let price = 3_420;
    for (let i = 0; i < 100; i++) {
      price += (Math.random() - 0.498) * price * 0.002;
      pts.push({ time: now - (100 - i), value: price });
    }
    return pts;
  }, []);

  useEffect(() => {
    let price = initialData[initialData.length - 1].value;
    const iv = setInterval(() => {
      price += (Math.random() - 0.498) * price * 0.002;
      const point: LivelinePoint = { time: Date.now() / 1000, value: price };
      chartRef.current?.push(point);
      setValue(price);
    }, 200);
    return () => clearInterval(iv);
  }, [initialData]);

  return (
    <div style={{ width: "100%", maxWidth: 900, height: 300 }}>
      <Liveline
        ref={chartRef}
        data={initialData}
        value={value}
        color="#3b82f6"
        window={30}
        grid
        fill
        momentum
        pulse
        scrub
        formatValue={(v) => `$${v.toFixed(2)}`}
      />
    </div>
  );
}

export function LivelineDegenDemo() {
  const chartRef = useRef<LivelineHandle>(null);
  const [value, setValue] = useState(69_420);

  const initialData = useMemo(() => {
    const now = Date.now() / 1000;
    const pts: LivelinePoint[] = [];
    let price = 69_420;
    for (let i = 0; i < 100; i++) {
      price += (Math.random() - 0.48) * price * 0.005;
      pts.push({ time: now - (100 - i), value: price });
    }
    return pts;
  }, []);

  useEffect(() => {
    let price = initialData[initialData.length - 1].value;
    const iv = setInterval(() => {
      price += (Math.random() - 0.48) * price * 0.005;
      const point: LivelinePoint = { time: Date.now() / 1000, value: price };
      chartRef.current?.push(point);
      setValue(price);
    }, 150);
    return () => clearInterval(iv);
  }, [initialData]);

  return (
    <div style={{ width: "100%", maxWidth: 900, height: 300 }}>
      <Liveline
        ref={chartRef}
        data={initialData}
        value={value}
        color="#22c55e"
        window={20}
        grid
        fill
        momentum
        pulse
        scrub
        exaggerate
        degen={{ scale: 1.2, downMomentum: true }}
        formatValue={(v) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
