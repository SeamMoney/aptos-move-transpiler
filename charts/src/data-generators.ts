import type { CandleInterval, OHLCDataPoint, TickerDataPoint } from "./types";

/**
 * Generate realistic OHLCV candlestick data using geometric Brownian motion.
 * Great for demos and testing.
 */
export function generateOHLCData(options: {
  /** Number of candles to generate */
  count?: number;
  /** Starting price */
  startPrice?: number;
  /** Volatility (0-1, where 0.02 is moderate) */
  volatility?: number;
  /** Upward drift per candle (0 = neutral, positive = bullish) */
  drift?: number;
  /** Candle time interval */
  interval?: CandleInterval;
  /** Starting date */
  startDate?: Date;
  /** Average volume */
  baseVolume?: number;
} = {}): OHLCDataPoint[] {
  const {
    count = 100,
    startPrice = 100,
    volatility = 0.025,
    drift = 0.0002,
    interval = "1h",
    startDate = new Date(Date.now() - intervalToMs(interval) * count),
    baseVolume = 50000,
  } = options;

  const data: OHLCDataPoint[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const date = new Date(startDate.getTime() + i * intervalToMs(interval));

    // GBM step
    const rand = gaussianRandom();
    const returns = drift + volatility * rand;
    const open = price;
    const close = open * (1 + returns);

    // Intra-candle high/low
    const bodySize = Math.abs(close - open);
    const wickExtension = bodySize * (0.5 + Math.random() * 1.5);
    const high = Math.max(open, close) + wickExtension * Math.random();
    const low = Math.min(open, close) - wickExtension * Math.random();

    // Volume with some correlation to price movement
    const volumeMultiplier = 1 + Math.abs(returns) * 20 + Math.random() * 0.5;
    const volume = Math.round(baseVolume * volumeMultiplier);

    data.push({
      date,
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      volume,
    });

    price = close;
  }

  return data;
}

/**
 * Generate realistic tick-level price data for line charts.
 * Simulates a fast-moving price stream.
 */
export function generateTickerData(options: {
  /** Number of ticks */
  count?: number;
  /** Starting price */
  startPrice?: number;
  /** Volatility per tick */
  volatility?: number;
  /** Drift per tick */
  drift?: number;
  /** Time between ticks in ms */
  tickIntervalMs?: number;
  /** Start date */
  startDate?: Date;
} = {}): TickerDataPoint[] {
  const {
    count = 300,
    startPrice = 42000,
    volatility = 0.001,
    drift = 0.00001,
    tickIntervalMs = 1000,
    startDate = new Date(Date.now() - tickIntervalMs * count),
  } = options;

  const data: TickerDataPoint[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const date = new Date(startDate.getTime() + i * tickIntervalMs);
    const rand = gaussianRandom();
    price *= 1 + drift + volatility * rand;

    data.push({
      date,
      price: roundPrice(price),
      volume: Math.round(Math.random() * 100 + 10),
    });
  }

  return data;
}

/**
 * Create a simulated real-time price stream.
 * Returns a cleanup function.
 *
 * @example
 * ```tsx
 * const chartRef = useRef<TickerLineChartHandle>(null);
 *
 * useEffect(() => {
 *   return createPriceStream({
 *     startPrice: 42000,
 *     intervalMs: 200,
 *     onTick: (point) => chartRef.current?.push(point),
 *   });
 * }, []);
 * ```
 */
export function createPriceStream(options: {
  startPrice?: number;
  volatility?: number;
  drift?: number;
  intervalMs?: number;
  onTick: (point: TickerDataPoint) => void;
}): () => void {
  const {
    startPrice = 42000,
    volatility = 0.0008,
    drift = 0,
    intervalMs = 200,
    onTick,
  } = options;

  let price = startPrice;
  let running = true;

  const tick = () => {
    if (!running) return;

    const rand = gaussianRandom();
    price *= 1 + drift + volatility * rand;

    onTick({
      date: new Date(),
      price: roundPrice(price),
      volume: Math.round(Math.random() * 50 + 5),
    });

    setTimeout(tick, intervalMs + Math.random() * intervalMs * 0.2);
  };

  tick();

  return () => {
    running = false;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function intervalToMs(interval: CandleInterval): number {
  const map: Record<CandleInterval, number> = {
    "1s": 1_000,
    "5s": 5_000,
    "15s": 15_000,
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 3_600_000,
    "4h": 4 * 3_600_000,
    "1d": 86_400_000,
  };
  return map[interval];
}

function gaussianRandom(): number {
  // Box-Muller transform
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function roundPrice(price: number): number {
  if (price >= 1000) return Math.round(price * 100) / 100;
  if (price >= 1) return Math.round(price * 10000) / 10000;
  return Math.round(price * 100000000) / 100000000;
}
