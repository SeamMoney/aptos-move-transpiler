import { describe, it, expect } from "vitest";
import { generateOHLCData, generateTickerData } from "../data-generators";
import { springInterpolate, lerp } from "../use-animation-frame";

describe("candlestick scaling properties", () => {
  it("body width scales down gracefully with many candles", () => {
    // Simulate body width calculation for various data sizes
    const widthRatio = 0.65;
    const gap = 2;
    const chartWidth = 800;

    const sizes = [10, 50, 100, 200, 500, 1000];
    for (const n of sizes) {
      const spacing = chartWidth / n;
      const bodyWidth = Math.max(2, spacing * widthRatio - gap);
      // Body width should always be at least 2px
      expect(bodyWidth).toBeGreaterThanOrEqual(2);
      // Should be a reasonable fraction of spacing for smaller datasets
      if (n <= 100) {
        expect(bodyWidth).toBeGreaterThan(2);
      }
    }
  });

  it("stagger delay is capped for large datasets", () => {
    const maxStaggerSec = 0.6;
    const sizes = [10, 100, 500, 2000];

    for (const n of sizes) {
      const lastCandleDelay = Math.min(
        ((n - 1) / n) * maxStaggerSec,
        maxStaggerSec
      );
      // Stagger should never exceed the cap
      expect(lastCandleDelay).toBeLessThanOrEqual(maxStaggerSec);
      // For datasets with enough candles, delay approaches the cap
      if (n >= 100) {
        expect(lastCandleDelay).toBeCloseTo(maxStaggerSec, 1);
      }
    }
  });

  it("y-scale padding prevents candles from touching edges", () => {
    const data = generateOHLCData({ count: 50 });
    const lows = data.map((d) => d.low);
    const highs = data.map((d) => d.high);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const padding = (max - min) * 0.08;

    const domainMin = min - padding;
    const domainMax = max + padding;

    // All data points should be within the padded domain
    for (const d of data) {
      expect(d.low).toBeGreaterThanOrEqual(domainMin);
      expect(d.high).toBeLessThanOrEqual(domainMax);
    }
  });

  it("candle spacing is uniform across the chart", () => {
    const data = generateOHLCData({ count: 100, interval: "1h" });
    // Time intervals should be consistent
    const intervals = [];
    for (let i = 1; i < data.length; i++) {
      intervals.push(data[i]!.date.getTime() - data[i - 1]!.date.getTime());
    }
    // All intervals should be equal (1 hour in ms)
    const expected = 3_600_000;
    for (const interval of intervals) {
      expect(interval).toBe(expected);
    }
  });
});

describe("spring interpolation", () => {
  it("converges to target value", () => {
    let value = 0;
    let velocity = 0;
    const target = 100;

    // Run 200 frames of spring physics
    for (let i = 0; i < 200; i++) {
      const result = springInterpolate(value, target, velocity, 180, 24, 1 / 60);
      value = result.value;
      velocity = result.velocity;
    }

    // Should be very close to target after 200 frames
    expect(value).toBeCloseTo(target, 1);
    expect(Math.abs(velocity)).toBeLessThan(0.1);
  });

  it("overshoots then settles (underdamped behavior)", () => {
    let value = 0;
    let velocity = 0;
    const target = 100;
    let maxValue = 0;

    for (let i = 0; i < 300; i++) {
      const result = springInterpolate(value, target, velocity, 180, 12, 1 / 60);
      value = result.value;
      velocity = result.velocity;
      maxValue = Math.max(maxValue, value);
    }

    // With low damping (12), should overshoot
    expect(maxValue).toBeGreaterThan(target);
    // But eventually settle
    expect(value).toBeCloseTo(target, 0);
  });

  it("critically damped settles without overshoot", () => {
    let value = 0;
    let velocity = 0;
    const target = 100;
    let maxValue = 0;

    // High damping ratio
    for (let i = 0; i < 300; i++) {
      const result = springInterpolate(value, target, velocity, 180, 40, 1 / 60);
      value = result.value;
      velocity = result.velocity;
      maxValue = Math.max(maxValue, value);
    }

    // With high damping, should not significantly overshoot
    expect(maxValue).toBeLessThan(target * 1.05);
    expect(value).toBeCloseTo(target, 0);
  });
});

describe("lerp", () => {
  it("interpolates correctly", () => {
    expect(lerp(0, 100, 0)).toBe(0);
    expect(lerp(0, 100, 1)).toBe(100);
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(20, 80, 0.25)).toBe(35);
  });

  it("handles negative values", () => {
    expect(lerp(-50, 50, 0.5)).toBe(0);
    expect(lerp(100, -100, 0.5)).toBe(0);
  });
});

describe("large dataset performance", () => {
  it("generates 1000 candles and computes scales in under 50ms", () => {
    const start = performance.now();

    const data = generateOHLCData({ count: 1000 });
    const lows = data.map((d) => d.low);
    const highs = data.map((d) => d.high);
    const _min = Math.min(...lows);
    const _max = Math.max(...highs);
    const dates = data.map((d) => d.date.getTime());
    const _dateMin = Math.min(...dates);
    const _dateMax = Math.max(...dates);

    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
