import { describe, it, expect } from "vitest";
import {
  generateOHLCData,
  generateTickerData,
  createPriceStream,
} from "../data-generators";

describe("generateOHLCData", () => {
  it("generates the requested number of candles", () => {
    const data = generateOHLCData({ count: 50 });
    expect(data).toHaveLength(50);
  });

  it("produces valid OHLC structure", () => {
    const data = generateOHLCData({ count: 10 });
    for (const d of data) {
      expect(d.date).toBeInstanceOf(Date);
      expect(typeof d.open).toBe("number");
      expect(typeof d.high).toBe("number");
      expect(typeof d.low).toBe("number");
      expect(typeof d.close).toBe("number");
      expect(typeof d.volume).toBe("number");
      expect(d.high).toBeGreaterThanOrEqual(Math.max(d.open, d.close));
      expect(d.low).toBeLessThanOrEqual(Math.min(d.open, d.close));
      expect(d.volume).toBeGreaterThan(0);
    }
  });

  it("dates are in chronological order", () => {
    const data = generateOHLCData({ count: 100 });
    for (let i = 1; i < data.length; i++) {
      expect(data[i]!.date.getTime()).toBeGreaterThan(
        data[i - 1]!.date.getTime()
      );
    }
  });

  it("respects startPrice approximately", () => {
    const data = generateOHLCData({ startPrice: 1000, count: 5, volatility: 0.001 });
    // First candle open should be close to startPrice
    expect(data[0]!.open).toBeCloseTo(1000, 0);
  });

  it("handles various intervals", () => {
    const intervals = ["1s", "5s", "1m", "5m", "1h", "4h", "1d"] as const;
    for (const interval of intervals) {
      const data = generateOHLCData({ count: 5, interval });
      expect(data).toHaveLength(5);
    }
  });

  it("scales to large datasets efficiently", () => {
    const start = performance.now();
    const data = generateOHLCData({ count: 10000 });
    const elapsed = performance.now() - start;
    expect(data).toHaveLength(10000);
    // Should generate 10k candles in under 200ms
    expect(elapsed).toBeLessThan(200);
  });
});

describe("generateTickerData", () => {
  it("generates the requested number of ticks", () => {
    const data = generateTickerData({ count: 200 });
    expect(data).toHaveLength(200);
  });

  it("produces valid ticker structure", () => {
    const data = generateTickerData({ count: 10 });
    for (const d of data) {
      expect(d.date).toBeInstanceOf(Date);
      expect(typeof d.price).toBe("number");
      expect(d.price).toBeGreaterThan(0);
    }
  });

  it("dates are in chronological order", () => {
    const data = generateTickerData({ count: 100 });
    for (let i = 1; i < data.length; i++) {
      expect(data[i]!.date.getTime()).toBeGreaterThan(
        data[i - 1]!.date.getTime()
      );
    }
  });
});

describe("createPriceStream", () => {
  it("emits ticks at roughly the specified interval", async () => {
    const ticks: number[] = [];
    const cleanup = createPriceStream({
      intervalMs: 50,
      onTick: (point) => {
        ticks.push(point.price);
      },
    });

    // Wait for a few ticks
    await new Promise((r) => setTimeout(r, 300));
    cleanup();

    // Should have received at least 3 ticks in 300ms at 50ms intervals
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    // All prices should be positive numbers
    for (const price of ticks) {
      expect(price).toBeGreaterThan(0);
    }
  });

  it("stops emitting after cleanup", async () => {
    let count = 0;
    const cleanup = createPriceStream({
      intervalMs: 20,
      onTick: () => { count++; },
    });

    await new Promise((r) => setTimeout(r, 100));
    cleanup();
    const countAtCleanup = count;

    await new Promise((r) => setTimeout(r, 100));
    // Should not have received more ticks after cleanup
    expect(count).toBe(countAtCleanup);
  });
});
